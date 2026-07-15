// Embudo lineal del proceso.
// Working Group queda FUERA del embudo lineal — es un calendario semanal de asistencia
// que corre en paralelo a Plan de Trabajo y se mide aparte (utils/wg.js).
// FIRMADO no es un evento — se marca manualmente al firmar el invitado.
const STAGES = [
  'REGISTRO',
  'BOM',
  'BOLETO_PAGO',
  'BOLETO_ABONADO',
  'BOLETO_NO_PAGO',
  'BOLETO_NO_INTERESADO',
  'BIT',
  'POWER_TALK',
  'PLAN_TRABAJO',
  'FIRMADO',
];

// Sub-etapas de "Boletos" (van entre BOM y BIT). NO_INTERESADO no entra en el embudo gráfico.
const BOLETO_STAGES = ['BOLETO_PAGO', 'BOLETO_ABONADO', 'BOLETO_NO_PAGO', 'BOLETO_NO_INTERESADO'];
const BOLETO_FUNNEL_STAGES = ['BOLETO_PAGO', 'BOLETO_ABONADO', 'BOLETO_NO_PAGO']; // gráficos

// WORKING_GROUP se mantiene como etiqueta de evento (el scanner lo recibe como stage_target)
// para registrar asistencia diaria, pero NO promueve current_stage.
const STAGE_EVENT_TARGETS = [...STAGES.filter((s) => s !== 'FIRMADO'), 'WORKING_GROUP'];

const STAGE_LABELS = {
  REGISTRO:        'Book',
  BOM:             'Show B.O.M',
  BOLETO_PAGO:     'Boleto Pago',
  BOLETO_ABONADO:  'Boleto Abonado',
  BOLETO_NO_PAGO:  'Boleto No Pago',
  BOLETO_NO_INTERESADO: 'Boleto No Interesado',
  BIT:             'B.I.T',
  POWER_TALK:      'Power Talk',
  PLAN_TRABAJO:    'Plan de Trabajo',
  WORKING_GROUP:   'Working Group',
  FIRMADO:         'Profesional Firmado',
};

// Eventos que el scanner puede registrar (todas las etapas escaneables + WG).
const SCANNABLE_STAGES = STAGE_EVENT_TARGETS;

// Promueve current_stage solo si el evento es parte del embudo lineal.
// Working Group nunca promueve: solo registra asistencia en wg_attendance.
function nextStageAfterScan(currentStage, targetStage) {
  if (targetStage === 'WORKING_GROUP') return currentStage;
  if (!STAGES.includes(targetStage)) return currentStage;
  const cur = STAGES.indexOf(currentStage);
  const tgt = STAGES.indexOf(targetStage);
  if (tgt > cur) return targetStage;
  return currentStage;
}

const ROLES = ['lider_supremo', 'system_leader', 'module_leader', 'productive_leader', 'distributor'];
const ROLE_LABELS = {
  lider_supremo:      'Líder Supremo',
  system_leader:      'Líder de Sistema',
  module_leader:      'Líder de Módulo',
  productive_leader:  'Líder Productivo',
  distributor:        'Profesional Activo',
};

// Roles que tienen mesa productiva propia: además de productive_leader, todo
// lider_modulo/lider_sistema/lider_supremo también actúa como líder productivo
// de su propia mesa personal (sus invitados directos + cualquier distributor
// cuyo productive_leader_id apunte a ellos).
const MESA_OWNER_ROLES = ['productive_leader', 'module_leader', 'system_leader', 'lider_supremo'];

module.exports = { STAGES, STAGE_LABELS, SCANNABLE_STAGES, BOLETO_STAGES, BOLETO_FUNNEL_STAGES, nextStageAfterScan, ROLES, ROLE_LABELS, MESA_OWNER_ROLES };
