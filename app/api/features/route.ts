import { startEngine, toggleFeature, getFeatures } from "@/lib/engine";
import { FeatureFlags } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  startEngine();
  return Response.json({ features: getFeatures() });
}

export async function POST(req: Request) {
  startEngine();
  const body = await req.json();
  const { feature, enabled } = body as { feature: keyof FeatureFlags; enabled: boolean };

  const validFeatures: (keyof FeatureFlags)[] = ["cameras", "boloV2", "feed511", "feedDataSF", "ships", "flights"];
  if (!validFeatures.includes(feature)) {
    return Response.json({ error: "Invalid feature" }, { status: 400 });
  }

  toggleFeature(feature, enabled);
  return Response.json({ features: getFeatures() });
}
