import { semanticFixture } from "./semanticChangeFixture";
import type { CoreRepository } from "../../server/core/types";
import {
  ADAPTIVE_WORKFLOW,
  type AdaptivePolicy,
} from "../../src/utils/adaptiveWorkflow";
import { adaptiveWorkflowDefinition } from "../../server/core/workflows/adaptiveWorkflow";
import {
  ensureDraft,
  saveDraft,
  validateVersion,
  promoteToTest,
  publishVersion,
} from "../../server/core/workflows/lifecycle";
export async function adaptiveFixture(repo: CoreRepository) {
  const f = await semanticFixture(repo);
  const def = adaptiveWorkflowDefinition();
  const policy = def.nodes.find((n) => n.id === "dispatch")!.params
    .adaptive_policy as AdaptivePolicy;
  policy.targets = {
    minimal: "style_analysis",
    light: "location_analysis",
    normal: "event_analysis",
    deep: "time_analysis",
  };
  const publish = async () => {
    const draft = await ensureDraft(repo, ADAPTIVE_WORKFLOW, "user:admin");
    await saveDraft(repo, {
      workflowId: ADAPTIVE_WORKFLOW,
      versionId: draft.id,
      definition: def,
      actor: "user:admin",
    });
    const val = await validateVersion(
      repo,
      ADAPTIVE_WORKFLOW,
      draft.id,
      "user:admin",
    );
    if (!val.validation.ok)
      throw new Error(JSON.stringify(val.validation.errors));
    await promoteToTest(repo, ADAPTIVE_WORKFLOW, draft.id, "user:admin");
    await publishVersion(repo, ADAPTIVE_WORKFLOW, draft.id, "user:admin");
  };
  await publish();
  await f.route("EVENT", ADAPTIVE_WORKFLOW);
  return { ...f, def, policy, publish };
}
