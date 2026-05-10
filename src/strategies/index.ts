import { BuscapeStrategy } from './buscape.strategy';
import { ConsultaRemediosStrategy } from './consulta-remedios.strategy';
import { DrogaRaiaStrategy } from './droga-raia.strategy';
import { DrogariaSaoPauloStrategy } from './drogaria-sao-paulo.strategy';
import { PagueMenosStrategy } from './pague-menos.strategy';
import type { PriceSourceStrategy } from '../types';

export function createDefaultStrategies(): PriceSourceStrategy[] {
  return [
    new ConsultaRemediosStrategy(),
    new DrogaRaiaStrategy(),
    new DrogariaSaoPauloStrategy(),
    new PagueMenosStrategy(),
    new BuscapeStrategy(),
  ];
}
