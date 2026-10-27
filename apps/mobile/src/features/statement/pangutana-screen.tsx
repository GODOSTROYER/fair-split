/**
 * M-MB-04 Pangutana (design §6 M4): who to ask, where and when; the member's right to see the co-op's records (RA
 * 9520 Art. 83); and "Ipasusi pag-usab", which sends her line, a slip and an optional note to the Mediation and
 * Conciliation Committee (Art. 43), with the status of the request she sent. States: none, composing, sending,
 * sent, failed, offline (IC-01). The board's Pangutana tab reuses this screen (register §4): the Chair sees who to
 * ask and the members' rights, without a member's line or its re-check.
 */
import { StyleSheet, View } from "react-native";
import { format } from "../../_shims/domain";
import { radius, space } from "../../_shims/tokens.native";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Screen } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { InkStamp } from "../../ui/primitives";
import { figures, Sentence } from "../../ui/sentence";
import { Skeleton } from "../../ui/states";
import { Txt } from "../../ui/text";
import { COLUMN, LangBar } from "./parts";
import { reviewScreenState } from "./review";
import { ReviewFields, ReviewStatus, useReviewForm } from "./review-form";
import { useStatement } from "./statement-store";
import { useT } from "./use-t";

export function PangutanaScreen() {
  const { lang, online, session } = useApp();
  const isMember = session?.role === "member";
  const { t } = useFs();
  const tr = useT();
  const st = useStatement({ enabled: isMember });
  const dto = isMember ? st.dto : null;
  const form = useReviewForm(dto, st.recordReview);
  const state = isMember
    ? reviewScreenState({ record: st.review, phase: form.phase, composing: form.composing, online })
    : online
      ? "none"
      : "offline";

  return (
    <Screen testID="M-MB-04" state={state} contentStyle={COLUMN}>
      <Txt kind="title1" accessibilityRole="header">
        {tr("M-MB-04.title")}
      </Txt>
      <LangBar testID="M-MB-04" glossable={false} />

      <View style={[styles.card, { backgroundColor: t.color.plate }]} testID="M-MB-04.who">
        <Txt kind="label" color="ink2" accessibilityRole="header">
          {tr("M-MB-04.whoTitle")}
        </Txt>
        {isMember && !dto ? (
          <Skeleton lines={2} />
        ) : (
          <>
            <View style={styles.who}>
              {dto ? <InkStamp initials={dto.treasurer.initials} label={dto.treasurer.name} /> : null}
              <View style={styles.flex}>
                <Txt kind="title2">
                  {dto ? tr("M-MB-04.treasurer", { name: dto.treasurer.name }) : tr("M-MB-04.treasurerOnly")}
                </Txt>
                <Txt kind="body" color="ink2">
                  {tr("M-MB-04.where")}
                </Txt>
              </View>
            </View>
            <Sentence
              lang={lang}
              segments={figures(
                dto?.cashDay
                  ? tr("M-MB-04.when", { date: format.date(dto.cashDay, lang) })
                  : tr("M-MB-04.whenAny"),
              )}
            />
          </>
        )}
      </View>

      <View style={styles.rights} testID="M-MB-04.rights">
        <Glyph name="people" size={24} color={t.color.ink2} />
        <View style={styles.flex}>
          <Txt kind="statementBody">{tr("M-MB-04.rights")}</Txt>
          <Txt kind="caption" color="ink3">
            {tr("M-MB-04.rightsCite")}
          </Txt>
        </View>
      </View>

      {isMember && dto ? (
        <View style={[styles.card, { backgroundColor: t.color.plate }]} testID="M-MB-04.recheck">
          <Txt kind="title2" accessibilityRole="header">
            {st.review ? tr("M-MB-04.yourRequest") : tr("M-MB-04.recheckTitle")}
          </Txt>
          {st.review ? (
            <ReviewStatus record={st.review} lang={lang} testID="M-MB-04.sent" />
          ) : (
            <>
              <Txt kind="body" color="ink2">
                {tr("M-MB-04.recheckBody")}
              </Txt>
              <ReviewFields dto={dto} form={form} testPrefix="M-MB-04" />
            </>
          )}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.s16, gap: space.s12, borderRadius: radius.none },
  who: { flexDirection: "row", alignItems: "center", gap: space.s12 },
  flex: { flex: 1 },
  rights: { flexDirection: "row", alignItems: "flex-start", gap: space.s12 },
});
