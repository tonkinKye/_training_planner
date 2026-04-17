import { SESSION_BODIES } from "./session-bodies.js";
import {
  buildSessionTemplatesModuleSource,
  createBlankTemplate,
  normalizeTemplate,
  normalizeTemplateLibrary,
  validateTemplate,
} from "./template-schema.js";

export const GO_LIVE_SESSION_KEY = "go_live";
export const KICK_OFF_SESSION_KEY = "kick_off_call";

export const BUILT_IN_TEMPLATES = [
  {
    key: "manufacturing",
    label: "Manufacturing",
    metadata: {
      version: 2,
    },
    phases: [
      {
        key: "setup",
        label: "Setup",
        owner: "pm",
        calendarSource: "pm",
        durationWeeks: { min: 3, max: 3 },
        stages: [
          {
            key: "kick_off_data_prep",
            label: "Kick-Off & Data Prep",
            sessions: [
              {
                key: "sales_handover",
                name: "Sales Handover",
                durationMinutes: 30,
                type: "internal",
                owner: "pm",
                bodyKey: "sales_handover",
              },
              {
                key: "installation",
                name: "Installation",
                durationMinutes: 60,
                type: "external",
                owner: "pm",
                bodyKey: "installation",
              },
              {
                key: "kick_off_call",
                name: "Kick-Off Call",
                durationMinutes: 90,
                type: "external",
                owner: "pm",
                bodyKey: "kick_off_call",
                gating: { type: "phase_gate" },
              },
              {
                key: "workflow_discovery",
                name: "Workflow Discovery",
                durationMinutes: 90,
                type: "external",
                owner: "pm",
                bodyKey: "workflow_discovery",
              },
              {
                key: "data_support_1",
                name: "Data Support 1",
                durationMinutes: 30,
                type: "external",
                owner: "pm",
                bodyKey: "data_support_1",
              },
              {
                key: "data_support_2",
                name: "Data Support 2",
                durationMinutes: 30,
                type: "external",
                owner: "pm",
                bodyKey: "data_support_2",
              },
              {
                key: "data_import_session",
                name: "Data Import Session",
                durationMinutes: 90,
                type: "external",
                owner: "pm",
                bodyKey: "data_import_session",
              },
              {
                key: "implementation_readiness",
                name: "Implementation Readiness",
                durationMinutes: 30,
                type: "external",
                owner: "pm",
                bodyKey: "implementation_readiness",
              },
              {
                key: "implementation_handover",
                name: "Imp. Handover",
                durationMinutes: 30,
                type: "internal",
                owner: "pm",
                bodyKey: "implementation_handover",
              },
            ],
          },
        ],
      },
      {
        key: "implementation",
        label: "Implementation",
        owner: "is",
        calendarSource: "is",
        durationWeeks: { min: 6, max: 8 },
        stages: [
          {
            key: "training",
            label: "Training",
            sessions: [
              {
                key: "materials_inventory",
                name: "Materials & Inventory",
                durationMinutes: 90,
                type: "external",
                owner: "is",
                bodyKey: "materials_inventory",
              },
              {
                key: "templates",
                name: "Templates",
                durationMinutes: 240,
                type: "external",
                owner: "is",
                bodyKey: "templates",
              },
              {
                key: "purchasing_fulfilment",
                name: "Purchasing & Fulfilment",
                durationMinutes: 90,
                type: "external",
                owner: "is",
                bodyKey: "purchasing_fulfilment",
              },
              {
                key: "recap_qa_1",
                name: "Recap QA",
                durationMinutes: 30,
                type: "external",
                owner: "is",
                bodyKey: "recap_qa",
              },
              {
                key: "sales_fulfilment",
                name: "Sales & Fulfilment",
                durationMinutes: 90,
                type: "external",
                owner: "is",
                bodyKey: "sales_fulfilment",
              },
              {
                key: "bill_of_materials",
                name: "Bill of Materials",
                durationMinutes: 60,
                type: "external",
                owner: "is",
                bodyKey: "bill_of_materials",
              },
              {
                key: "recap_qa_2",
                name: "Recap QA",
                durationMinutes: 30,
                type: "external",
                owner: "is",
                bodyKey: "recap_qa",
              },
              {
                key: "manufacturing",
                name: "Manufacturing",
                durationMinutes: 90,
                type: "external",
                owner: "is",
                bodyKey: "manufacturing",
              },
              {
                key: "advanced_mobile",
                name: "Fishbowl Advanced Mobile",
                durationMinutes: 90,
                type: "external",
                owner: "is",
                bodyKey: "advanced_mobile",
              },
              {
                key: "recap_qa_3",
                name: "Recap QA",
                durationMinutes: 30,
                type: "external",
                owner: "is",
                bodyKey: "recap_qa",
              },
              {
                key: "plugins_accounting",
                name: "Plugins & Accounting",
                durationMinutes: 90,
                type: "external",
                owner: "is",
                bodyKey: "plugins_accounting",
              },
              {
                key: "workflow",
                name: "Workflow",
                durationMinutes: 90,
                type: "external",
                owner: "is",
                bodyKey: "workflow",
              },
            ],
          },
          {
            key: "go_live_prep",
            label: "Go Live Prep",
            sessions: [
              {
                key: "go_live_prep",
                name: "Go Live Prep",
                durationMinutes: 90,
                type: "external",
                owner: "is",
                bodyKey: "go_live_prep",
              },
            ],
          },
          {
            key: "go_live",
            label: "Go-Live",
            sessions: [
              {
                key: "go_live",
                name: "Go-Live",
                durationMinutes: 120,
                type: "external",
                owner: "is",
                bodyKey: "go_live",
                locked: true,
              },
            ],
          },
        ],
      },
      {
        key: "hypercare",
        label: "Hypercare",
        owner: "pm",
        calendarSource: "pm",
        durationWeeks: { min: 1, max: 2 },
        stages: [
          {
            key: "post_go_live",
            label: "Post Go-Live",
            sessions: [
              {
                key: "pm_handover",
                name: "PM Handover",
                durationMinutes: 30,
                type: "internal",
                owner: "pm",
                bodyKey: "pm_handover",
              },
              {
                key: "training_support_1",
                name: "Training Support 1",
                durationMinutes: 60,
                type: "external",
                owner: "pm",
                bodyKey: "training_support",
              },
              {
                key: "training_support_2",
                name: "Training Support 2",
                durationMinutes: 60,
                type: "external",
                owner: "pm",
                bodyKey: "training_support",
              },
              {
                key: "training_support_3",
                name: "Training Support 3",
                durationMinutes: 60,
                type: "external",
                owner: "pm",
                bodyKey: "training_support",
              },
              {
                key: "training_support_4",
                name: "Training Support 4",
                durationMinutes: 60,
                type: "external",
                owner: "pm",
                bodyKey: "training_support",
              },
              {
                key: "support_handover",
                name: "Support Handover",
                durationMinutes: 15,
                type: "external",
                owner: "pm",
                bodyKey: "support_handover",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: "warehousing",
    label: "Warehousing",
    metadata: {
      version: 2,
    },
    phases: [
      {
        key: "setup",
        label: "Setup",
        owner: "pm",
        calendarSource: "pm",
        durationWeeks: { min: 3, max: 3 },
        stages: [
          {
            key: "kick_off_data_prep",
            label: "Kick-Off & Data Prep",
            sessions: [
              {
                key: "sales_handover",
                name: "Sales Handover",
                durationMinutes: 30,
                type: "internal",
                owner: "pm",
                bodyKey: "sales_handover",
              },
              {
                key: "installation",
                name: "Installation",
                durationMinutes: 60,
                type: "external",
                owner: "pm",
                bodyKey: "installation",
              },
              {
                key: "kick_off_call",
                name: "Kick-Off Call",
                durationMinutes: 90,
                type: "external",
                owner: "pm",
                bodyKey: "kick_off_call",
                gating: { type: "phase_gate" },
              },
              {
                key: "workflow_discovery",
                name: "Workflow Discovery",
                durationMinutes: 90,
                type: "external",
                owner: "pm",
                bodyKey: "workflow_discovery",
              },
              {
                key: "data_support_1",
                name: "Data Support 1",
                durationMinutes: 30,
                type: "external",
                owner: "pm",
                bodyKey: "data_support_1",
              },
              {
                key: "data_support_2",
                name: "Data Support 2",
                durationMinutes: 30,
                type: "external",
                owner: "pm",
                bodyKey: "data_support_2",
              },
              {
                key: "data_import_session",
                name: "Data Import Session",
                durationMinutes: 90,
                type: "external",
                owner: "pm",
                bodyKey: "data_import_session",
              },
              {
                key: "implementation_readiness",
                name: "Implementation Readiness",
                durationMinutes: 30,
                type: "external",
                owner: "pm",
                bodyKey: "implementation_readiness",
              },
              {
                key: "implementation_handover",
                name: "Imp. Handover",
                durationMinutes: 30,
                type: "internal",
                owner: "pm",
                bodyKey: "implementation_handover",
              },
            ],
          },
        ],
      },
      {
        key: "implementation",
        label: "Implementation",
        owner: "is",
        calendarSource: "is",
        durationWeeks: { min: 6, max: 8 },
        stages: [
          {
            key: "training",
            label: "Training",
            sessions: [
              {
                key: "materials_inventory",
                name: "Materials & Inventory",
                durationMinutes: 90,
                type: "external",
                owner: "is",
                bodyKey: "materials_inventory",
              },
              {
                key: "templates",
                name: "Templates",
                durationMinutes: 180,
                type: "external",
                owner: "is",
                bodyKey: "templates",
              },
              {
                key: "purchasing_fulfilment",
                name: "Purchasing & Fulfilment",
                durationMinutes: 90,
                type: "external",
                owner: "is",
                bodyKey: "purchasing_fulfilment",
              },
              {
                key: "recap_qa_1",
                name: "Recap QA",
                durationMinutes: 30,
                type: "external",
                owner: "is",
                bodyKey: "recap_qa",
              },
              {
                key: "sales_fulfilment",
                name: "Sales & Fulfilment",
                durationMinutes: 90,
                type: "external",
                owner: "is",
                bodyKey: "sales_fulfilment",
              },
              {
                key: "bill_of_materials",
                name: "Bill of Materials",
                durationMinutes: 30,
                type: "external",
                owner: "is",
                bodyKey: "bill_of_materials",
              },
              {
                key: "recap_qa_2",
                name: "Recap QA",
                durationMinutes: 30,
                type: "external",
                owner: "is",
                bodyKey: "recap_qa",
              },
              {
                key: "advanced_mobile",
                name: "Fishbowl Advanced Mobile",
                durationMinutes: 90,
                type: "external",
                owner: "is",
                bodyKey: "advanced_mobile",
              },
              {
                key: "recap_qa_3",
                name: "Recap QA",
                durationMinutes: 30,
                type: "external",
                owner: "is",
                bodyKey: "recap_qa",
              },
              {
                key: "plugins_accounting",
                name: "Plugins & Accounting",
                durationMinutes: 90,
                type: "external",
                owner: "is",
                bodyKey: "plugins_accounting",
              },
              {
                key: "workflow",
                name: "Workflow",
                durationMinutes: 90,
                type: "external",
                owner: "is",
                bodyKey: "workflow",
              },
            ],
          },
          {
            key: "go_live_prep",
            label: "Go Live Prep",
            sessions: [
              {
                key: "go_live_prep",
                name: "Go Live Prep",
                durationMinutes: 90,
                type: "external",
                owner: "is",
                bodyKey: "go_live_prep",
              },
            ],
          },
          {
            key: "go_live",
            label: "Go-Live",
            sessions: [
              {
                key: "go_live",
                name: "Go-Live",
                durationMinutes: 120,
                type: "external",
                owner: "is",
                bodyKey: "go_live",
                locked: true,
              },
            ],
          },
        ],
      },
      {
        key: "hypercare",
        label: "Hypercare",
        owner: "pm",
        calendarSource: "pm",
        durationWeeks: { min: 1, max: 2 },
        stages: [
          {
            key: "post_go_live",
            label: "Post Go-Live",
            sessions: [
              {
                key: "pm_handover",
                name: "PM Handover",
                durationMinutes: 30,
                type: "internal",
                owner: "pm",
                bodyKey: "pm_handover",
              },
              {
                key: "training_support_1",
                name: "Training Support 1",
                durationMinutes: 60,
                type: "external",
                owner: "pm",
                bodyKey: "training_support",
              },
              {
                key: "training_support_2",
                name: "Training Support 2",
                durationMinutes: 60,
                type: "external",
                owner: "pm",
                bodyKey: "training_support",
              },
              {
                key: "training_support_3",
                name: "Training Support 3",
                durationMinutes: 60,
                type: "external",
                owner: "pm",
                bodyKey: "training_support",
              },
              {
                key: "support_handover",
                name: "Support Handover",
                durationMinutes: 15,
                type: "external",
                owner: "pm",
                bodyKey: "support_handover",
              },
            ],
          },
        ],
      },
    ],
  },
  createBlankTemplate({
    key: "custom",
    label: "Custom",
    metadata: { version: 2 },
  }),
];

const BUILT_IN_TEMPLATE_LIBRARY = normalizeTemplateLibrary(BUILT_IN_TEMPLATES);

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function getBuiltInTemplates() {
  return cloneValue(BUILT_IN_TEMPLATES);
}

export function getTemplateLibrary() {
  return cloneValue(BUILT_IN_TEMPLATE_LIBRARY);
}

export function getRawTemplateDefinition(templateKey) {
  return cloneValue(
    BUILT_IN_TEMPLATES.find((template) => template.key === templateKey)
      || BUILT_IN_TEMPLATES.find((template) => template.key === "custom")
      || BUILT_IN_TEMPLATES[0]
  );
}

export function getTemplateDefinition(templateKey, { templateSnapshot = null } = {}) {
  if (templateSnapshot) return normalizeTemplate(templateSnapshot);
  return cloneValue(
    BUILT_IN_TEMPLATE_LIBRARY.byKey[templateKey]
      || BUILT_IN_TEMPLATE_LIBRARY.byKey.custom
      || BUILT_IN_TEMPLATE_LIBRARY.templates[0]
  );
}

export function getTemplatePhases(templateKey, options = {}) {
  return cloneValue(getTemplateDefinition(templateKey, options).phaseMap || {});
}

export function getTemplateSessions(templateKey, options = {}) {
  return cloneValue(getTemplateDefinition(templateKey, options).sessions || []);
}

export function getTemplateOptions() {
  return BUILT_IN_TEMPLATE_LIBRARY.templates.map((template) => ({
    key: template.key,
    label: template.label,
  }));
}

export function getTemplateLabel(templateKey) {
  return getTemplateDefinition(templateKey)?.label || getTemplateDefinition("custom")?.label || "Custom";
}

export function getSessionBody(sessionKey, sessionName) {
  return (
    SESSION_BODIES[sessionKey]
    || `This session covers ${sessionName}.\n\nPlease come prepared with relevant examples, open questions, and any required system access.`
  );
}

export function getTemplateReviewJSON(templates = BUILT_IN_TEMPLATES) {
  return JSON.stringify(templates, null, 2);
}

export function serializeTemplateLibrarySource(templates = BUILT_IN_TEMPLATES) {
  return buildSessionTemplatesModuleSource(templates);
}

export {
  buildSessionTemplatesModuleSource,
  createBlankTemplate,
  normalizeTemplate,
  normalizeTemplateLibrary,
  validateTemplate,
};
