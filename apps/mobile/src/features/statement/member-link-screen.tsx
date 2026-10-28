/**
 * `/app/s/:token`, the member's link (register §4): Ed25519-signed by fs-api, valid 30 days, one line, read only.
 * The phone reads the token's claims only to explain an expired or broken link without a round trip; the server
 * verifies the signature when it serves the line, so it is handed the token as it signed it (`check.token`: a link
 * written dot-free, with `~`, is read back to `body.sig`). A valid link opens the same statement, read only: no
 * re-check, no demo controls, and Paminawa opens in place.
 */
import { useLocalSearchParams } from "expo-router";
import { readMemberLink } from "../../lib/member-link";
import { Screen } from "../../ui/chrome";
import { EmptyState } from "../../ui/states";
import { BayadScreen } from "./bayad-screen";
import { COLUMN, LangBar } from "./parts";
import { StatementProvider } from "./statement-store";
import { useT } from "./use-t";

export function MemberLinkScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const tr = useT();
  const raw = typeof token === "string" ? token : "";
  const check = readMemberLink(raw, new Date());
  if (!check.ok) {
    const expired = check.reason === "expired";
    return (
      <Screen testID="M-MB-01" state={expired ? "link-expired" : "link-invalid"} contentStyle={COLUMN}>
        <LangBar testID="M-MB-01" glossable={false} />
        <EmptyState
          glyph={expired ? "clock" : "info"}
          title={tr("M-MB-01.linkTitle")}
          body={tr(expired ? "M-MB-01.linkExpired" : "M-MB-01.linkInvalid")}
          testID="M-MB-01.link"
        />
      </Screen>
    );
  }
  return (
    <StatementProvider linkToken={check.token} linkLineId={check.lineId}>
      <BayadScreen readOnlyUntil={check.exp} />
    </StatementProvider>
  );
}
