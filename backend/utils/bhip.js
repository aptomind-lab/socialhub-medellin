// Rangos BHIP — de menor a mayor.
const BHIP_RANKS = [
  'Profesional',
  'Bronce',
  'Plata',
  'Oro',
  'Platino',
  'Zafiro',
  'Rubí',
  'Esmeralda',
  'Diamante',
  'Diamante Azul',
  'Diamante Negro',
];

function isValidRank(r) {
  return typeof r === 'string' && BHIP_RANKS.includes(r);
}

function rankIndex(r) {
  return BHIP_RANKS.indexOf(r);
}

module.exports = { BHIP_RANKS, isValidRank, rankIndex };
