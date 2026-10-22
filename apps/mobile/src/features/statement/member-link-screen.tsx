/**
 * `/app/s/:token`, the member's link (register §4): Ed25519-signed, valid 30 days, one line, read only. The phone
 * reads the claims to explain an expired or broken link; the server verifies the signature when it serves the line.
 */
import { useLocalSearchParams } from "expo-router";
import { readMemberLink } from "../../lib/member-link";
import { Screen } from "../../ui/chrome";
import { Banner } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import { BayadScreen } from "./bayad-screen";
import { useT } from "./use-t";

export function MemberLinkScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const tr = useT();
  const check = readMemberLink(typeof token === "string" ? token : "", new Date());
  if (!check.ok) {
    return (
      <Screen testID="M-MB-01" state={check.reason === "expired" ? "link-expired" : "link-invalid"}>
        <Banner tone="decide" icon="info">
          <Txt kind="body">
            {tr(check.reason === "expired" ? "M-MB-01.linkExpired" : "M-MB-01.linkInvalid")}
          </Txt>
        </Banner>
      </Screen>
    );
  }
  return <BayadScreen linkToken={token} />;
}
