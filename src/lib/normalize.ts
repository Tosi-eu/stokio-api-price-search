/**
 * Canonicalização de strings para a chave do cache de preços (L2).
 *
 * O objetivo é fazer com que variações de escrita (caixa, acentos, espaços
 * múltiplos, hífens etc.) colapsem em uma única chave — assim "Dipirona",
 * "DIPIRONA", "dipirôna" e "dipirona  " viram a mesma entrada no cache.
 *
 * Os valores `*Canonical` armazenados na tabela usam string vazia (não NULL)
 * para representar "sem valor", de forma que o índice `@@unique` funcione
 * sem precisar de partial indexes — Postgres considera NULLs distintos.
 */
export type ItemType = 'medicine' | 'input';

export interface CanonicalKey {
  itemType: ItemType;
  nameCanonical: string;
  dosageCanonical: string;
  unitCanonical: string;
}

export interface OriginalInput {
  itemName: string;
  dosage?: string;
  measurementUnit?: string;
}

export function canonicalizeText(s: string | undefined | null): string {
  if (s === undefined || s === null) return '';
  const stripped = s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped;
}

/**
 * Normaliza dosagem numérica como "500,0mg" -> "500", "1/2" -> "0.5/1" etc.
 * Mantém compatibilidade com o helper do backend (`abrigo/backend/src/helpers/dosage.helper.ts`).
 */
export function normalizeDosage(dosage: string): string {
  if (!dosage || typeof dosage !== 'string') {
    return dosage;
  }

  const parts = dosage.split('/');
  const numerator = parts[0].trim().replace(',', '.');

  const numValue = parseFloat(numerator);
  if (isNaN(numValue)) {
    return dosage.trim();
  }

  const normalizedNumerator =
    numValue % 1 === 0
      ? numValue.toString()
      : numValue.toString().replace(/\.?0+$/, '');

  if (parts.length > 1) {
    const denominator = parts[1].trim().replace(',', '.');
    const denValue = parseFloat(denominator);
    if (!isNaN(denValue)) {
      const normalizedDenominator =
        denValue % 1 === 0
          ? denValue.toString()
          : denValue.toString().replace(/\.?0+$/, '');
      return `${normalizedNumerator}/${normalizedDenominator}`;
    }
    return `${normalizedNumerator}/${denominator}`;
  }

  return normalizedNumerator;
}

/**
 * Constrói a chave canônica para lookup/upsert.
 * Para `input`, dosage/unit são sempre vazios (busca de insumos é só pelo nome).
 */
export function canonicalKey(
  itemType: ItemType,
  input: OriginalInput,
): CanonicalKey {
  const nameCanonical = canonicalizeText(input.itemName);
  if (!nameCanonical) {
    throw new Error('canonicalKey: itemName é obrigatório');
  }

  if (itemType === 'input') {
    return {
      itemType,
      nameCanonical,
      dosageCanonical: '',
      unitCanonical: '',
    };
  }

  const dosageNormalized = input.dosage ? normalizeDosage(input.dosage) : '';
  return {
    itemType,
    nameCanonical,
    dosageCanonical: canonicalizeText(dosageNormalized),
    unitCanonical: canonicalizeText(input.measurementUnit),
  };
}

/**
 * Chave string compacta para uso em logs e Redis (versionada para invalidar
 * cache antigo quando mudarmos o algoritmo).
 */
export const CACHE_KEY_VERSION = 'v2';

export function canonicalCacheKey(key: CanonicalKey): string {
  const parts = [
    'pricing',
    CACHE_KEY_VERSION,
    key.itemType,
    key.nameCanonical,
    key.dosageCanonical || '-',
    key.unitCanonical || '-',
  ];
  return parts.join(':').replace(/\s+/g, '_');
}

/**
 * Termo para `GET .../api/catalog_system/pub/products/search/{term}` (VTEX).
 * O segmento de path com caracteres como `( ) %` em nomes compostos (ex.: solução 0,9%)
 * pode responder **400**; reutilizamos a mesma limpeza da chave de cache.
 */
export function vtexCatalogSearchQuery(itemName: string, dosage?: string): string {
  const combined = canonicalizeText(`${itemName} ${dosage ?? ''}`.trim());
  const fallback = canonicalizeText(itemName);
  let out = (combined || fallback).trim();
  if (!out) {
    out = String(itemName ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }
  return out.slice(0, 120);
}
