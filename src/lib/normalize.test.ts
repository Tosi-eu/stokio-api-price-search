import {
  CACHE_KEY_VERSION,
  canonicalCacheKey,
  canonicalKey,
  canonicalizeText,
  normalizeDosage,
  vtexCatalogSearchQuery,
} from './normalize';

describe('canonicalizeText', () => {
  it('strips accents and lowercases', () => {
    expect(canonicalizeText('Dipirôna')).toBe('dipirona');
    expect(canonicalizeText('DIPIRONA')).toBe('dipirona');
    expect(canonicalizeText('dipirona')).toBe('dipirona');
    expect(canonicalizeText('Diprona')).toBe('diprona');
  });

  it('collapses whitespace and trims', () => {
    expect(canonicalizeText('  Dipirona   500   mg  ')).toBe('dipirona 500 mg');
  });

  it('treats hyphens and underscores as separators', () => {
    expect(canonicalizeText('dipirona-500mg')).toBe('dipirona 500mg');
    expect(canonicalizeText('dipirona_500_mg')).toBe('dipirona 500 mg');
  });

  it('returns empty string for null/undefined/empty', () => {
    expect(canonicalizeText(undefined)).toBe('');
    expect(canonicalizeText(null)).toBe('');
    expect(canonicalizeText('')).toBe('');
    expect(canonicalizeText('   ')).toBe('');
  });

  it('keeps numeric and decimal separators useful for dosage', () => {
    expect(canonicalizeText('500/1')).toBe('500/1');
    expect(canonicalizeText('2,5')).toBe('2,5');
    expect(canonicalizeText('1.25')).toBe('1.25');
  });

  it('removes letters with diacritics across the spectrum', () => {
    expect(canonicalizeText('Paracetamól')).toBe('paracetamol');
    expect(canonicalizeText('âêîôûñ')).toBe('aeioun');
  });
});

describe('normalizeDosage', () => {
  it('normalizes simple decimal forms', () => {
    expect(normalizeDosage('500')).toBe('500');
    expect(normalizeDosage('500,0')).toBe('500');
    expect(normalizeDosage('500.0')).toBe('500');
    expect(normalizeDosage('2,5')).toBe('2.5');
  });

  it('normalizes fractions', () => {
    expect(normalizeDosage('500/10')).toBe('500/10');
    expect(normalizeDosage('500,0/10,0')).toBe('500/10');
  });

  it('passes non-numeric content through trimmed', () => {
    expect(normalizeDosage('mg')).toBe('mg');
    expect(normalizeDosage('  ')).toBe('');
  });
});

describe('canonicalKey', () => {
  it('builds key for medicine with dosage and unit', () => {
    const k = canonicalKey('medicine', {
      itemName: 'Dipirôna',
      dosage: '500,0',
      measurementUnit: 'MG',
    });
    expect(k).toEqual({
      itemType: 'medicine',
      nameCanonical: 'dipirona',
      dosageCanonical: '500',
      unitCanonical: 'mg',
    });
  });

  it('produces same key for many spelling variants of the same medicine', () => {
    const variants = [
      { itemName: 'Dipirona', dosage: '500', measurementUnit: 'mg' },
      { itemName: 'DIPIRONA', dosage: '500.0', measurementUnit: 'mg' },
      { itemName: 'dipirôna', dosage: '500,0', measurementUnit: 'MG' },
      { itemName: '  Dipirona  ', dosage: '500', measurementUnit: '  mg  ' },
    ];
    const keys = variants.map(v => canonicalKey('medicine', v));
    const first = keys[0];
    for (const k of keys) {
      expect(k).toEqual(first);
    }
  });

  it('keeps distinct keys when dosage info is embedded in the item name', () => {
    // Inputs em que a dosagem aparece no nome não colapsam com o nome puro,
    // pois o canonical inclui números — esse é o comportamento desejado para
    // não confundir "Dipirona" com "Dipirona Infantil 200" etc.
    const a = canonicalKey('medicine', { itemName: 'Dipirona' });
    const b = canonicalKey('medicine', { itemName: 'dipirona-500' });
    expect(a.nameCanonical).toBe('dipirona');
    expect(b.nameCanonical).toBe('dipirona 500');
    expect(a.nameCanonical).not.toBe(b.nameCanonical);
  });

  it('ignores dosage and measurementUnit for input items', () => {
    const k = canonicalKey('input', {
      itemName: 'Seringa Descartável',
      dosage: '5ml',
      measurementUnit: 'un',
    });
    expect(k).toEqual({
      itemType: 'input',
      nameCanonical: 'seringa descartavel',
      dosageCanonical: '',
      unitCanonical: '',
    });
  });

  it('rejects empty itemName', () => {
    expect(() =>
      canonicalKey('medicine', { itemName: '   ' }),
    ).toThrow();
  });
});

describe('canonicalCacheKey', () => {
  it('builds versioned compact key for medicine', () => {
    const k = canonicalKey('medicine', {
      itemName: 'Dipirona',
      dosage: '500',
      measurementUnit: 'mg',
    });
    const ck = canonicalCacheKey(k);
    expect(ck).toBe(`pricing:${CACHE_KEY_VERSION}:medicine:dipirona:500:mg`);
  });

  it('uses dash placeholder for empty dosage/unit (input)', () => {
    const k = canonicalKey('input', { itemName: 'algodão' });
    const ck = canonicalCacheKey(k);
    expect(ck).toBe(`pricing:${CACHE_KEY_VERSION}:input:algodao:-:-`);
  });

  it('replaces whitespace in name with underscore', () => {
    const k = canonicalKey('input', { itemName: 'soro fisiológico' });
    expect(canonicalCacheKey(k)).toBe(
      `pricing:${CACHE_KEY_VERSION}:input:soro_fisiologico:-:-`,
    );
  });
});

describe('vtexCatalogSearchQuery', () => {
  it('remove caracteres que quebram o path VTEX (parênteses, %)', () => {
    expect(
      vtexCatalogSearchQuery('Nasonew (cloreto de sódio 0,9%)', '30'),
    ).toBe('nasonew cloreto de sodio 0,9 30');
  });

  it('preserva dosagem numérica útil', () => {
    expect(vtexCatalogSearchQuery('Cinacalcete', '30')).toBe('cinacalcete 30');
  });
});
