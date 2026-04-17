export const EXPECTED_TEMPLATE_RUNTIME_PARITY = {
  manufacturing: {
    key: "manufacturing",
    label: "Manufacturing",
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
              { key: "sales_handover", name: "Sales Handover", durationMinutes: 30, owner: "pm", type: "internal", locked: false, gating: null, bodyKey: "sales_handover" },
              { key: "installation", name: "Installation", durationMinutes: 60, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "installation" },
              { key: "kick_off_call", name: "Kick-Off Call", durationMinutes: 90, owner: "pm", type: "external", locked: false, gating: { type: "phase_gate" }, bodyKey: "kick_off_call" },
              { key: "workflow_discovery", name: "Workflow Discovery", durationMinutes: 90, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "workflow_discovery" },
              { key: "data_support_1", name: "Data Support 1", durationMinutes: 30, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "data_support_1" },
              { key: "data_support_2", name: "Data Support 2", durationMinutes: 30, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "data_support_2" },
              { key: "data_import_session", name: "Data Import Session", durationMinutes: 90, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "data_import_session" },
              { key: "implementation_readiness", name: "Implementation Readiness", durationMinutes: 30, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "implementation_readiness" },
              { key: "implementation_handover", name: "Imp. Handover", durationMinutes: 30, owner: "pm", type: "internal", locked: false, gating: null, bodyKey: "implementation_handover" },
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
              { key: "materials_inventory", name: "Materials & Inventory", durationMinutes: 90, owner: "is", type: "external", locked: false, gating: null, bodyKey: "materials_inventory" },
              { key: "templates", name: "Templates", durationMinutes: 240, owner: "is", type: "external", locked: false, gating: null, bodyKey: "templates" },
              { key: "purchasing_fulfilment", name: "Purchasing & Fulfilment", durationMinutes: 90, owner: "is", type: "external", locked: false, gating: null, bodyKey: "purchasing_fulfilment" },
              { key: "recap_qa_1", name: "Recap QA", durationMinutes: 30, owner: "is", type: "external", locked: false, gating: null, bodyKey: "recap_qa" },
              { key: "sales_fulfilment", name: "Sales & Fulfilment", durationMinutes: 90, owner: "is", type: "external", locked: false, gating: null, bodyKey: "sales_fulfilment" },
              { key: "bill_of_materials", name: "Bill of Materials", durationMinutes: 60, owner: "is", type: "external", locked: false, gating: null, bodyKey: "bill_of_materials" },
              { key: "recap_qa_2", name: "Recap QA", durationMinutes: 30, owner: "is", type: "external", locked: false, gating: null, bodyKey: "recap_qa" },
              { key: "manufacturing", name: "Manufacturing", durationMinutes: 90, owner: "is", type: "external", locked: false, gating: null, bodyKey: "manufacturing" },
              { key: "advanced_mobile", name: "Fishbowl Advanced Mobile", durationMinutes: 90, owner: "is", type: "external", locked: false, gating: null, bodyKey: "advanced_mobile" },
              { key: "recap_qa_3", name: "Recap QA", durationMinutes: 30, owner: "is", type: "external", locked: false, gating: null, bodyKey: "recap_qa" },
              { key: "plugins_accounting", name: "Plugins & Accounting", durationMinutes: 90, owner: "is", type: "external", locked: false, gating: null, bodyKey: "plugins_accounting" },
              { key: "workflow", name: "Workflow", durationMinutes: 90, owner: "is", type: "external", locked: false, gating: null, bodyKey: "workflow" },
            ],
          },
          {
            key: "go_live_prep",
            label: "Go-Live Prep",
            sessions: [
              { key: "go_live_prep", name: "Go Live Prep", durationMinutes: 90, owner: "is", type: "external", locked: false, gating: null, bodyKey: "go_live_prep" },
            ],
          },
          {
            key: "go_live",
            label: "Go-Live",
            sessions: [
              { key: "go_live", name: "Go-Live", durationMinutes: 120, owner: "is", type: "external", locked: true, gating: null, bodyKey: "go_live" },
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
              { key: "pm_handover", name: "PM Handover", durationMinutes: 30, owner: "pm", type: "internal", locked: false, gating: null, bodyKey: "pm_handover" },
              { key: "training_support_1", name: "Training Support 1", durationMinutes: 60, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "training_support" },
              { key: "training_support_2", name: "Training Support 2", durationMinutes: 60, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "training_support" },
              { key: "training_support_3", name: "Training Support 3", durationMinutes: 60, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "training_support" },
              { key: "training_support_4", name: "Training Support 4", durationMinutes: 60, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "training_support" },
              { key: "support_handover", name: "Support Handover", durationMinutes: 15, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "support_handover" },
            ],
          },
        ],
      },
    ],
  },
  warehousing: {
    key: "warehousing",
    label: "Warehousing",
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
              { key: "sales_handover", name: "Sales Handover", durationMinutes: 30, owner: "pm", type: "internal", locked: false, gating: null, bodyKey: "sales_handover" },
              { key: "installation", name: "Installation", durationMinutes: 60, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "installation" },
              { key: "kick_off_call", name: "Kick-Off Call", durationMinutes: 90, owner: "pm", type: "external", locked: false, gating: { type: "phase_gate" }, bodyKey: "kick_off_call" },
              { key: "workflow_discovery", name: "Workflow Discovery", durationMinutes: 90, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "workflow_discovery" },
              { key: "data_support_1", name: "Data Support 1", durationMinutes: 30, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "data_support_1" },
              { key: "data_support_2", name: "Data Support 2", durationMinutes: 30, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "data_support_2" },
              { key: "data_import_session", name: "Data Import Session", durationMinutes: 90, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "data_import_session" },
              { key: "implementation_readiness", name: "Implementation Readiness", durationMinutes: 30, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "implementation_readiness" },
              { key: "implementation_handover", name: "Imp. Handover", durationMinutes: 30, owner: "pm", type: "internal", locked: false, gating: null, bodyKey: "implementation_handover" },
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
              { key: "materials_inventory", name: "Materials & Inventory", durationMinutes: 90, owner: "is", type: "external", locked: false, gating: null, bodyKey: "materials_inventory" },
              { key: "templates", name: "Templates", durationMinutes: 180, owner: "is", type: "external", locked: false, gating: null, bodyKey: "templates" },
              { key: "purchasing_fulfilment", name: "Purchasing & Fulfilment", durationMinutes: 90, owner: "is", type: "external", locked: false, gating: null, bodyKey: "purchasing_fulfilment" },
              { key: "recap_qa_1", name: "Recap QA", durationMinutes: 30, owner: "is", type: "external", locked: false, gating: null, bodyKey: "recap_qa" },
              { key: "sales_fulfilment", name: "Sales & Fulfilment", durationMinutes: 90, owner: "is", type: "external", locked: false, gating: null, bodyKey: "sales_fulfilment" },
              { key: "bill_of_materials", name: "Bill of Materials", durationMinutes: 30, owner: "is", type: "external", locked: false, gating: null, bodyKey: "bill_of_materials" },
              { key: "recap_qa_2", name: "Recap QA", durationMinutes: 30, owner: "is", type: "external", locked: false, gating: null, bodyKey: "recap_qa" },
              { key: "advanced_mobile", name: "Fishbowl Advanced Mobile", durationMinutes: 90, owner: "is", type: "external", locked: false, gating: null, bodyKey: "advanced_mobile" },
              { key: "recap_qa_3", name: "Recap QA", durationMinutes: 30, owner: "is", type: "external", locked: false, gating: null, bodyKey: "recap_qa" },
              { key: "plugins_accounting", name: "Plugins & Accounting", durationMinutes: 90, owner: "is", type: "external", locked: false, gating: null, bodyKey: "plugins_accounting" },
              { key: "workflow", name: "Workflow", durationMinutes: 90, owner: "is", type: "external", locked: false, gating: null, bodyKey: "workflow" },
            ],
          },
          {
            key: "go_live_prep",
            label: "Go-Live Prep",
            sessions: [
              { key: "go_live_prep", name: "Go Live Prep", durationMinutes: 90, owner: "is", type: "external", locked: false, gating: null, bodyKey: "go_live_prep" },
            ],
          },
          {
            key: "go_live",
            label: "Go-Live",
            sessions: [
              { key: "go_live", name: "Go-Live", durationMinutes: 120, owner: "is", type: "external", locked: true, gating: null, bodyKey: "go_live" },
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
              { key: "pm_handover", name: "PM Handover", durationMinutes: 30, owner: "pm", type: "internal", locked: false, gating: null, bodyKey: "pm_handover" },
              { key: "training_support_1", name: "Training Support 1", durationMinutes: 60, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "training_support" },
              { key: "training_support_2", name: "Training Support 2", durationMinutes: 60, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "training_support" },
              { key: "training_support_3", name: "Training Support 3", durationMinutes: 60, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "training_support" },
              { key: "support_handover", name: "Support Handover", durationMinutes: 15, owner: "pm", type: "external", locked: false, gating: null, bodyKey: "support_handover" },
            ],
          },
        ],
      },
    ],
  },
};
