import { createFileRoute } from "@tanstack/react-router";
import { useDocumentTitle } from "../../chrome/Fallbacks.js";
import { Surface } from "../../chrome/Surface.js";
import { Screen } from "../../screens/W-BR-01/index.js";

// W-BR-01's entry: the signed brand link `/b/:token` (30 days) opens Proof with the brand header (S3.8).
export const Route = createFileRoute("/b/$token")({
  component: function BrandRoute() {
    const { token } = Route.useParams();
    useDocumentTitle("Proof for the brand");
    return (
      <Surface theme="adlaw" className="fsc-surface fsc-surface--proof">
        <Screen token={token} />
      </Surface>
    );
  },
});
