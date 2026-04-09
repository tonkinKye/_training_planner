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
  advanced_mobile: "Training on Fishbowl Advanced Mobile setup, roles, and operational workflows on device.",
  plugins_accounting: "Training on plugins and accounting-adjacent workflows, including integration touchpoints and reporting impact.",
  workflow: "Workflow design and refinement session based on agreed implementation requirements.",
  go_live_prep: "Go-live preparation session covering cutover readiness, responsibilities, and opening-day plan.",
  pm_handover: "Internal PM handover into hypercare covering remaining risks, support posture, and ownership.",
  training_support: "Post go-live support session to resolve issues, reinforce workflows, and close knowledge gaps.",
  support_handover: "Internal support handover confirming transition into ongoing support ownership.",
};

const INTERNAL_BODY_KEYS = new Set([
  "sales_handover",
  "implementation_handover",
  "pm_handover",
]);

function makeTemplateSession(key, name, duration, phase, owner, bodyKey = key) {
  return {
    key,
    bodyKey,
    name,
    duration,
    phase,
    owner,
    type: INTERNAL_BODY_KEYS.has(bodyKey) ? "internal" : "external",
  };
}

const MANUFACTURING = [
  makeTemplateSession("sales_handover", "Sales Handover", 30, "setup", "pm"),
  makeTemplateSession("installation", "Installation", 60, "setup", "pm"),
  makeTemplateSession("kick_off_call", "Kick-Off Call", 90, "setup", "pm"),
  makeTemplateSession("workflow_discovery", "Workflow Discovery", 90, "setup", "pm"),
  makeTemplateSession("data_support_1", "Data Support 1", 30, "setup", "pm"),
  makeTemplateSession("data_support_2", "Data Support 2", 30, "setup", "pm"),
  makeTemplateSession("data_import_session", "Data Import Session", 90, "setup", "pm"),
  makeTemplateSession("implementation_readiness", "Implementation Readiness", 30, "setup", "pm"),
  makeTemplateSession("implementation_handover", "Imp. Handover", 30, "setup", "pm"),
  makeTemplateSession("materials_inventory", "Materials & Inventory", 90, "implementation", "is"),
  makeTemplateSession("templates", "Templates", 240, "implementation", "is"),
  makeTemplateSession("purchasing_fulfilment", "Purchasing & Fulfilment", 90, "implementation", "is"),
  makeTemplateSession("recap_qa_1", "Recap QA", 30, "implementation", "is", "recap_qa"),
  makeTemplateSession("sales_fulfilment", "Sales & Fulfilment", 90, "implementation", "is"),
  makeTemplateSession("bill_of_materials", "Bill of Materials", 60, "implementation", "is"),
  makeTemplateSession("recap_qa_2", "Recap QA", 30, "implementation", "is", "recap_qa"),
  makeTemplateSession("manufacturing", "Manufacturing", 90, "implementation", "is"),
  makeTemplateSession("advanced_mobile", "Fishbowl Advanced Mobile", 90, "implementation", "is"),
  makeTemplateSession("recap_qa_3", "Recap QA", 30, "implementation", "is", "recap_qa"),
  makeTemplateSession("plugins_accounting", "Plugins & Accounting", 90, "implementation", "is"),
  makeTemplateSession("workflow", "Workflow", 90, "implementation", "is"),
  makeTemplateSession("go_live_prep", "Go Live Prep", 90, "implementation", "is"),
  makeTemplateSession("pm_handover", "PM Handover", 30, "hypercare", "pm"),
  makeTemplateSession("training_support_1", "Training Support 1", 60, "hypercare", "pm", "training_support"),
  makeTemplateSession("training_support_2", "Training Support 2", 60, "hypercare", "pm", "training_support"),
  makeTemplateSession("training_support_3", "Training Support 3", 60, "hypercare", "pm", "training_support"),
  makeTemplateSession("training_support_4", "Training Support 4", 60, "hypercare", "pm", "training_support"),
  makeTemplateSession("support_handover", "Support Handover", 15, "hypercare", "pm"),
];

const WAREHOUSING = [
  makeTemplateSession("sales_handover", "Sales Handover", 30, "setup", "pm"),
  makeTemplateSession("installation", "Installation", 60, "setup", "pm"),
  makeTemplateSession("kick_off_call", "Kick-Off Call", 90, "setup", "pm"),
  makeTemplateSession("workflow_discovery", "Workflow Discovery", 90, "setup", "pm"),
  makeTemplateSession("data_support_1", "Data Support 1", 30, "setup", "pm"),
  makeTemplateSession("data_support_2", "Data Support 2", 30, "setup", "pm"),
  makeTemplateSession("data_import_session", "Data Import Session", 90, "setup", "pm"),
  makeTemplateSession("implementation_readiness", "Implementation Readiness", 30, "setup", "pm"),
  makeTemplateSession("implementation_handover", "Imp. Handover", 30, "setup", "pm"),
  makeTemplateSession("materials_inventory", "Materials & Inventory", 90, "implementation", "is"),
  makeTemplateSession("templates", "Templates", 240, "implementation", "is"),
  makeTemplateSession("purchasing_fulfilment", "Purchasing & Fulfilment", 90, "implementation", "is"),
  makeTemplateSession("recap_qa_1", "Recap QA", 30, "implementation", "is", "recap_qa"),
  makeTemplateSession("sales_fulfilment", "Sales & Fulfilment", 90, "implementation", "is"),
  makeTemplateSession("bill_of_materials", "Bill of Materials", 30, "implementation", "is"),
  makeTemplateSession("recap_qa_2", "Recap QA", 30, "implementation", "is", "recap_qa"),
  makeTemplateSession("advanced_mobile", "Fishbowl Advanced Mobile", 90, "implementation", "is"),
  makeTemplateSession("recap_qa_3", "Recap QA", 30, "implementation", "is", "recap_qa"),
  makeTemplateSession("plugins_accounting", "Plugins & Accounting", 90, "implementation", "is"),
  makeTemplateSession("workflow", "Workflow", 90, "implementation", "is"),
  makeTemplateSession("go_live_prep", "Go Live Prep", 90, "implementation", "is"),
  makeTemplateSession("pm_handover", "PM Handover", 30, "hypercare", "pm"),
  makeTemplateSession("training_support_1", "Training Support 1", 60, "hypercare", "pm", "training_support"),
  makeTemplateSession("training_support_2", "Training Support 2", 60, "hypercare", "pm", "training_support"),
  makeTemplateSession("training_support_3", "Training Support 3", 60, "hypercare", "pm", "training_support"),
  makeTemplateSession("support_handover", "Support Handover", 15, "hypercare", "pm"),
];

export const PROJECT_TEMPLATES = {
  manufacturing: MANUFACTURING,
  warehousing: WAREHOUSING,
  custom: [],
};

export const GO_LIVE_ANCHOR = {
  key: "go_live_anchor",
  bodyKey: "go_live_anchor",
  name: "Go-Live",
  duration: 120,
  owner: "pm",
  type: "context",
  phase: "implementation",
};

export function getTemplateSessions(projectType) {
  return (PROJECT_TEMPLATES[projectType] || []).map((session, index) => ({
    ...session,
    order: index,
  }));
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
