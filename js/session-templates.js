const SESSION_BODIES = {
  sales_handover: "Internal handover to confirm project scope, stakeholders, and responsibilities before customer-facing work begins.",
  installation: "Installation and environment readiness session covering access, prerequisites, and deployment checks.",
  kick_off_call: "Customer kickoff covering introductions, scope, implementation stages, responsibilities, and immediate next steps.",
  workflow_discovery: "Discovery session focused on current workflows, business rules, and success criteria for configuration.",
  data_support_1: "Data support checkpoint to review file readiness, mapping assumptions, and open data questions.",
  data_support_2: "Second data support checkpoint to finalize file quality, edge cases, and import readiness.",
  data_import_session: "Guided data import session covering load execution, validation, and re-import contingencies.",
  implementation_readiness: "Readiness review to confirm implementation prerequisites, ownership, and handoff preparedness.",
  implementation_handover: "Internal PM-to-IS handover covering delivery context, risks, and implementation plan.",
  materials_inventory: "Training on materials and inventory structure, movements, controls, and core workflows.",
  templates: "Extended configuration workshop for templates, forms, and setup patterns that require focused build time.",
  purchasing_fulfilment: "Training on purchasing, receiving, and fulfilment flows including practical end-to-end walkthroughs.",
  recap_qa: "Short recap and Q&A checkpoint to review progress, validate understanding, and clear blockers.",
  sales_fulfilment: "Training on sales order and fulfilment workflows with real examples and expected outcomes.",
  bill_of_materials: "Training on BOM setup, validation, and practical usage in day-to-day workflows.",
  manufacturing: "Training on manufacturing workflow, execution, and process controls for production teams.",
  advanced_mobile: "Training on Fishbowl Advanced Mobile setup, user roles, and operational workflows including receiving, picking, transfers, and cycle counts on device.",
  plugins_accounting: "Training on plugins and accounting-adjacent workflows, including integration touchpoints and reporting impact.",
  workflow: "Workflow design and refinement session based on agreed implementation requirements.",
  go_live_prep: "Go-live preparation session covering cutover readiness, responsibilities, and opening-day plan.",
  go_live: "Go-live session covering cutover execution, ownership, and live operational support for the opening day.",
  pm_handover: "Internal PM handover into hypercare covering remaining risks, support posture, and ownership.",
  training_support: "Post go-live support session to resolve issues, reinforce workflows, and close knowledge gaps.",
  support_handover: "Internal support handover confirming transition into ongoing support ownership.",
};

const INTERNAL_BODY_KEYS = new Set([
  "sales_handover",
  "implementation_handover",
  "pm_handover",
]);

export const GO_LIVE_SESSION_KEY = "go_live";
export const KICK_OFF_SESSION_KEY = "kick_off_call";

function makeTemplateSession(key, name, duration, owner, bodyKey = key) {
  return {
    key,
    bodyKey,
    name,
    duration,
    owner,
    type: INTERNAL_BODY_KEYS.has(bodyKey) ? "internal" : "external",
  };
}

function makeStage(key, label, sessions) {
  return {
    key,
    label,
    sessions,
  };
}

function makePhase(suggestedWeeksMin, suggestedWeeksMax, stages) {
  return {
    suggestedWeeksMin,
    suggestedWeeksMax,
    stages,
  };
}

const MANUFACTURING = {
  phases: {
    setup: makePhase(3, 3, [
      makeStage("kick_off_data_prep", "Kick-Off & Data Prep", [
        makeTemplateSession("sales_handover", "Sales Handover", 30, "pm"),
        makeTemplateSession("installation", "Installation", 60, "pm"),
        makeTemplateSession("kick_off_call", "Kick-Off Call", 90, "pm"),
        makeTemplateSession("workflow_discovery", "Workflow Discovery", 90, "pm"),
        makeTemplateSession("data_support_1", "Data Support 1", 30, "pm"),
        makeTemplateSession("data_support_2", "Data Support 2", 30, "pm"),
        makeTemplateSession("data_import_session", "Data Import Session", 90, "pm"),
        makeTemplateSession("implementation_readiness", "Implementation Readiness", 30, "pm"),
        makeTemplateSession("implementation_handover", "Imp. Handover", 30, "pm"),
      ]),
    ]),
    implementation: makePhase(6, 8, [
      makeStage("training", "Training", [
        makeTemplateSession("materials_inventory", "Materials & Inventory", 90, "is"),
        makeTemplateSession("templates", "Templates", 240, "is"),
        makeTemplateSession("purchasing_fulfilment", "Purchasing & Fulfilment", 90, "is"),
        makeTemplateSession("recap_qa_1", "Recap QA", 30, "is", "recap_qa"),
        makeTemplateSession("sales_fulfilment", "Sales & Fulfilment", 90, "is"),
        makeTemplateSession("bill_of_materials", "Bill of Materials", 60, "is"),
        makeTemplateSession("recap_qa_2", "Recap QA", 30, "is", "recap_qa"),
        makeTemplateSession("manufacturing", "Manufacturing", 90, "is"),
        makeTemplateSession("advanced_mobile", "Fishbowl Advanced Mobile", 90, "is", "advanced_mobile"),
        makeTemplateSession("recap_qa_3", "Recap QA", 30, "is", "recap_qa"),
        makeTemplateSession("plugins_accounting", "Plugins & Accounting", 90, "is"),
        makeTemplateSession("workflow", "Workflow", 90, "is"),
      ]),
      makeStage("go_live_prep", "Go Live Prep", [
        makeTemplateSession("go_live_prep", "Go Live Prep", 90, "is"),
      ]),
      makeStage("go_live", "Go-Live", [
        makeTemplateSession(GO_LIVE_SESSION_KEY, "Go-Live", 120, "is"),
      ]),
    ]),
    hypercare: makePhase(1, 2, [
      makeStage("post_go_live", "Post Go-Live", [
        makeTemplateSession("pm_handover", "PM Handover", 30, "pm"),
        makeTemplateSession("training_support_1", "Training Support 1", 60, "pm", "training_support"),
        makeTemplateSession("training_support_2", "Training Support 2", 60, "pm", "training_support"),
        makeTemplateSession("training_support_3", "Training Support 3", 60, "pm", "training_support"),
        makeTemplateSession("training_support_4", "Training Support 4", 60, "pm", "training_support"),
        makeTemplateSession("support_handover", "Support Handover", 15, "pm"),
      ]),
    ]),
  },
};

const WAREHOUSING = {
  phases: {
    setup: makePhase(3, 3, [
      makeStage("kick_off_data_prep", "Kick-Off & Data Prep", [
        makeTemplateSession("sales_handover", "Sales Handover", 30, "pm"),
        makeTemplateSession("installation", "Installation", 60, "pm"),
        makeTemplateSession("kick_off_call", "Kick-Off Call", 90, "pm"),
        makeTemplateSession("workflow_discovery", "Workflow Discovery", 90, "pm"),
        makeTemplateSession("data_support_1", "Data Support 1", 30, "pm"),
        makeTemplateSession("data_support_2", "Data Support 2", 30, "pm"),
        makeTemplateSession("data_import_session", "Data Import Session", 90, "pm"),
        makeTemplateSession("implementation_readiness", "Implementation Readiness", 30, "pm"),
        makeTemplateSession("implementation_handover", "Imp. Handover", 30, "pm"),
      ]),
    ]),
    implementation: makePhase(6, 8, [
      makeStage("training", "Training", [
        makeTemplateSession("materials_inventory", "Materials & Inventory", 90, "is"),
        makeTemplateSession("templates", "Templates", 180, "is"),
        makeTemplateSession("purchasing_fulfilment", "Purchasing & Fulfilment", 90, "is"),
        makeTemplateSession("recap_qa_1", "Recap QA", 30, "is", "recap_qa"),
        makeTemplateSession("sales_fulfilment", "Sales & Fulfilment", 90, "is"),
        makeTemplateSession("bill_of_materials", "Bill of Materials", 30, "is"),
        makeTemplateSession("recap_qa_2", "Recap QA", 30, "is", "recap_qa"),
        makeTemplateSession("advanced_mobile", "Fishbowl Advanced Mobile", 90, "is", "advanced_mobile"),
        makeTemplateSession("recap_qa_3", "Recap QA", 30, "is", "recap_qa"),
        makeTemplateSession("plugins_accounting", "Plugins & Accounting", 90, "is"),
        makeTemplateSession("workflow", "Workflow", 90, "is"),
      ]),
      makeStage("go_live_prep", "Go Live Prep", [
        makeTemplateSession("go_live_prep", "Go Live Prep", 90, "is"),
      ]),
      makeStage("go_live", "Go-Live", [
        makeTemplateSession(GO_LIVE_SESSION_KEY, "Go-Live", 120, "is"),
      ]),
    ]),
    hypercare: makePhase(1, 2, [
      makeStage("post_go_live", "Post Go-Live", [
        makeTemplateSession("pm_handover", "PM Handover", 30, "pm"),
        makeTemplateSession("training_support_1", "Training Support 1", 60, "pm", "training_support"),
        makeTemplateSession("training_support_2", "Training Support 2", 60, "pm", "training_support"),
        makeTemplateSession("training_support_3", "Training Support 3", 60, "pm", "training_support"),
        makeTemplateSession("support_handover", "Support Handover", 15, "pm"),
      ]),
    ]),
  },
};

const CUSTOM = {
  phases: {
    setup: makePhase(null, null, []),
    implementation: makePhase(null, null, []),
    hypercare: makePhase(null, null, []),
  },
};

export const PROJECT_TEMPLATES = {
  manufacturing: MANUFACTURING,
  warehousing: WAREHOUSING,
  custom: CUSTOM,
};

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function getTemplateDefinition(projectType) {
  return cloneValue(PROJECT_TEMPLATES[projectType] || PROJECT_TEMPLATES.custom);
}

export function getTemplatePhases(projectType) {
  return getTemplateDefinition(projectType).phases;
}

export function getTemplateSessions(projectType) {
  const template = getTemplateDefinition(projectType);
  const phaseOrder = ["setup", "implementation", "hypercare"];
  let order = 0;
  return phaseOrder.flatMap((phaseKey) =>
    (template.phases[phaseKey]?.stages || []).flatMap((stage) =>
      stage.sessions.map((session) => ({
        ...session,
        phase: phaseKey,
        stageKey: stage.key,
        stageLabel: stage.label,
        order: order++,
      }))
    )
  );
}

export function getSessionBody(sessionKey, sessionName) {
  return (
    SESSION_BODIES[sessionKey] ||
    `This session covers ${sessionName}.\n\nPlease come prepared with relevant examples, open questions, and any required system access.`
  );
}

export function getTemplateReviewJSON() {
  return JSON.stringify(PROJECT_TEMPLATES, null, 2);
}
