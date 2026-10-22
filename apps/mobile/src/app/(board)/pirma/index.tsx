import { Redirect } from "expo-router";
import { runSlug } from "../../../_shims/seed";

/** TEMPORARY: the open co-sign request will come from push or the workspace feed (WS-API); the fixture run until then. */
export default function PirmaIndex() {
  return <Redirect href={`/pirma/${runSlug}` as never} />;
}
