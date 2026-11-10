import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import { fetchConnectionModels } from "@/lib/liveModels";
import { getLiveModels } from "open-sse/providers/catalogOverride.js";

/**
 * GET /api/providers/[id]/models - Get models list from provider.
 * `?cached=1` returns the list stored at boot or last refresh when there is one.
 */
export async function GET(request, { params }) {
  const { id } = await params;
  const connection = await getProviderConnectionById(id);
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (new URL(request.url).searchParams.get("cached") === "1") {
    const models = getLiveModels(connection.provider);
    if (models?.length) return NextResponse.json({ provider: connection.provider, connectionId: connection.id, models, cached: true });
  }
  const { body, status } = await fetchConnectionModels(connection);
  return NextResponse.json(body, { status });
}
