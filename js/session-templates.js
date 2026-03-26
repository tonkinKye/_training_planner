export const FISHBOWL_SESSIONS = [
  { name: "Kick-Off Call", duration: 90 },
  { name: "Data Prep", duration: 90 },
  { name: "Data Import", duration: 90 },
  { name: "Materials & Inventory Management", duration: 90 },
  { name: "Purchasing & Receiving", duration: 90 },
  { name: "Recap & Questions", duration: 45 },
  { name: "Sales & Fulfilment", duration: 90 },
  { name: "Bill of Materials", duration: 90 },
  { name: "Recap & Questions", duration: 45 },
  { name: "Production & Manufacturing", duration: 90 },
  { name: "Fishbowl Advanced Mobile", duration: 90 },
  { name: "Recap & Questions", duration: 45 },
  { name: "Reports, Plugins & Dashboards", duration: 90 },
  { name: "Workflow Creation", duration: 90 },
  { name: "Go-Live Prep 1", duration: 90 },
  { name: "Go-Live Prep 2", duration: 90 },
  { name: "Go-Live", duration: 120 },
  { name: "Support Handover", duration: 20 },
];

export function getSessionBody(sessionName) {
  const bodies = {
    "Kick-Off Call": `Hi Team,

Welcome to your Fishbowl Implementation Kick-Off session.

In this meeting, we'll cover:
- Welcome & Introductions
- Customer Support Overview
- About Your Business
- Implementation Project Overview & Stages
- Logging In to Fishbowl
- Datasheets & Requirements
- Next Steps

Preparation:
- Please ensure key stakeholders attend.
- Have your current process notes and any existing data sheets ready if available.

Outcome:
- Confirm scope, approach, responsibilities, and next steps.`,

    "Data Prep": `Hi team,

This session is Data Prep - we'll review your data, confirm mapping, and ensure files are ready for import.

In this meeting, we'll cover:
- Data readiness check
- File structure & mapping review
- Setup assumptions (UOMs, locations, tax codes)
- Next Steps before Data Import

Preparation:
- Have the latest data files ready (Parts, Customers, Suppliers)
- Confirm Locations / UOM structure`,

    "Data Import": `Hi team,

This session is the Data Import - importing core records into Fishbowl so training can start on a clean foundation.

In this meeting, we'll cover:
- Import Parts/Products, Customers, Suppliers (+ BOMs if applicable)
- Validation spot-check
- Re-import plan if needed
- Next Steps

Preparation:
- Final data files ready`,

    "Materials & Inventory Management": `Hi team,

This session covers Materials & Inventory Management in Fishbowl.

In this meeting, we'll cover:
- Inventory structure (Parts vs Products)
- Locations & bins
- Part setup essentials (lead times, reorder points, vendors)
- Inventory movements (adjustments, transfers, cycle counts)
- Workflow test

Preparation:
- Confirm locations/bins list
- Bring 5-10 example SKUs`,

    "Purchasing & Receiving": `Hi team,

This session covers Purchasing & Receiving in Fishbowl.

In this meeting, we'll cover:
- Creating Purchase Orders
- Receiving stock (full + partial)
- Key purchasing reports
- Workflow test: PO > receive > confirm stock

Preparation:
- Have 1-2 real supplier examples ready`,

    "Recap & Questions": `Hi team,

This is a Recap & Q&A checkpoint. Please come prepared with any questions from previous sessions.

We'll review progress, address blockers, and confirm next steps.`,

    "Sales & Fulfilment": `Hi team,

This session covers Sales & Fulfilment in Fishbowl.

In this meeting, we'll cover:
- Creating Sales Orders
- Picking & packing workflow
- Shipping confirmation
- Key sales reports
- Workflow test: Sales Order > pick/pack > ship

Preparation:
- Have 1-2 real customer examples ready`,

    "Bill of Materials": `Hi team,

This session covers Bill of Materials (BOM) in Fishbowl.

In this meeting, we'll cover:
- BOM fundamentals (finished good, components)
- BOM setup best practices
- Creating and validating BOMs
- Workflow test: build 1-2 BOMs

Preparation:
- Bring 1-2 real products as BOM examples`,

    "Production & Manufacturing": `Hi team,

This session covers Production & Manufacturing in Fishbowl.

In this meeting, we'll cover:
- Work Order setup
- Creating a Work Order from BOM
- Finishing production
- Workflow test: WO > issue > finish > confirm inventory

Preparation:
- Ensure at least 1 BOM is validated`,

    "Fishbowl Advanced Mobile": `Hi team,

This session covers Fishbowl Advanced Mobile.

In this meeting, we'll cover:
- Mobile overview (mobile vs desktop tasks)
- User setup & permissions
- Core workflows: receiving, picking, transfers, cycle counts
- Workflow test

Preparation:
- Identify mobile users and roles
- Confirm devices are available`,

    "Reports, Plugins & Dashboards": `Hi team,

This session covers Plugins and Reporting in Fishbowl.

In this meeting, we'll cover:
- Plugins/integrations in scope
- Core reporting (inventory, purchasing, sales, production)
- Saving report favourites
- Workflow test: run key reports

Preparation:
- Bring your must-have reports list`,

    "Workflow Creation": `Hi team,

This session covers Workflow Creation in Fishbowl based on the training sessions held.

We'll identify, build and test key workflows together.`,

    "Go-Live Prep 1": `Hi team,

This session is Go-Live Prep. We'll review the readiness checklist, confirm opening data requirements, and lock the cutover plan.

In this meeting, we'll cover:
- Go Live readiness checklist review
- Opening data plan (stocktake, open POs/SOs/WOs)
- Cutover plan and responsibilities
- Risks & escalation plan
- Next Steps

Preparation:
- Confirm stocktake method and timing
- Ensure decision-maker can attend`,

    "Go-Live Prep 2": `Hi team,

This is our second Go-Live Prep - final checks and confirming everything is in place.

Please bring any outstanding questions or blockers.`,

    "Go-Live": `Hi team,

This is the Go-Live session!

In this meeting, we'll cover:
- Final readiness confirmation
- Apply opening data and final stock counts
- First live transactions walkthrough
- Reporting verification
- Confirm support pathway

Preparation:
- Opening stock counts ready
- Key users available
- Decision-maker available for sign-off`,

    "Support Handover": `Hi team,

This session is the Support Handover call - confirming you're comfortable post go-live and know how to get help.

In this meeting, we'll cover:
- Post go-live check-in
- Support pathway overview
- How to log tickets efficiently
- Remaining open actions`,
  };

  return (
    bodies[sessionName] ||
    `Hi team,

This session covers ${sessionName}.

Please come prepared and ensure your system access is working.

Thanks,`
  );
}
