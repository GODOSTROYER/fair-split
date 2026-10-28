/**
 * M-MB-02 Resibo (design §6 M2): her slips, each as paper with its serial, date and net kilos, adding up to the
 * kilos on her line. Tapping a slip runs MM-7 inside this screen: it zooms into the slip where the clerk wrote her
 * kilos. "Dili tugma?" starts a re-check with that slip already chosen. States: loading, list, empty, offline, error.
 */
import { useRef, useState } from "react";
import { Pressable, StyleSheet, View, type ViewInstance } from "react-native";
import type { StatementDTO } from "../../_shims/api-client";
import type { Lang } from "../../_shims/contracts";
import { radius, space } from "../../_shims/tokens.native";
import { slipFigures, slipTotal } from "../../lib/figures";
import { audioPlan, MONEY_SLOTS } from "../../lib/statement";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Screen } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { MomentMarker, useMoment } from "../../ui/moment";
import { Sheet } from "../../ui/overlay";
import { Banner, Button, Rule } from "../../ui/primitives";
import { EmptyState, OfflineBar, Skeleton } from "../../ui/states";
import { Txt } from "../../ui/text";
import { ownerOf } from "./bayad-screen";
import { lineView } from "./line-view";
import { traceState } from "./mm7";
import { COLUMN, LangBar } from "./parts";
import { ReviewFields, ReviewStatus, useReviewForm } from "./review-form";
import { SlipPaper } from "./slip-paper";
import type { TapPoint } from "./slip-tiles";
import { SlipZoom } from "./slip-zoom";
import { useStatement } from "./statement-store";
import { usePhoneVoice } from "./use-paminawa";
import { useT } from "./use-t";

export function ResiboScreen() {
  const { lang } = useApp();
  const tr = useT();
  const st = useStatement();
  if (!st.dto || !st.capsule) {
    return (
      <Screen testID="M-MB-02" state={st.status === "error" ? "error" : "loading"} contentStyle={COLUMN}>
        <Txt kind="title1" accessibilityRole="header">
          {tr("M-MB-02.title")}
        </Txt>
        {st.status === "error" ? (
          <EmptyState
            glyph="wifiOff"
            title={tr("M-MB-01.loadFailed")}
            body={tr("M-MB-01.loadFailedBody")}
            testID="M-MB-02.error"
            action={
              <Button
                variant="tonal"
                icon="refresh"
                label={tr("common.tryAgain")}
                onPress={() => void st.reload()}
              />
            }
          />
        ) : (
          <Skeleton lines={4} block={96} />
        )}
      </Screen>
    );
  }
  return <Slips dto={st.dto} lang={lang} />;
}

function Slips({ dto, lang }: { dto: StatementDTO; lang: Lang }) {
  const { online, demo } = useApp();
  const { t } = useFs();
  const tr = useT();
  const st = useStatement();
  const mm7 = useMoment("MM-7", "rest");
  const [zoom, setZoom] = useState<{ serial: string; at: TapPoint } | null>(null);
  const [recheck, setRecheck] = useState(false);
  const refs = useRef<Record<string, ViewInstance | null>>({});
  const owner = ownerOf(dto);
  const total = slipTotal(dto);
  const voice = usePhoneVoice(lang);
  const view = st.capsule ? lineView(dto, st.capsule, st.track, lang) : null;
  const plan = audioPlan(dto, lang, {
    deviceVoice: !!voice,
    rail: view?.payKind,
    exclude: view && !view.showAmount ? MONEY_SLOTS : undefined,
    playable: () => online,
  });
  const step = plan.steps.find((s) => s.slot === "SOURCES");
  const sources = { mode: plan.mode, steps: step ? [{ ...step, index: 0 }] : [] };
  const review = useReviewForm(dto, st.recordReview);
  // Without a signal, what is on screen is the last copy, whether it came from this session or from the phone.
  const offline = !online;

  const open = (serial: string) => {
    const node = refs.current[serial];
    if (!node) return setZoom({ serial, at: { x: 0, y: 0 } });
    node.measureInWindow((x, y, w, h) => setZoom({ serial, at: { x: x + w / 2, y: y + h / 2 } }));
  };

  const state = offline ? "offline" : dto.slips.length ? "list" : "empty";

  return (
    <View style={styles.fill}>
      <Screen testID="M-MB-02" state={state} contentStyle={COLUMN}>
        <View style={styles.titles}>
          <Txt kind="title1" accessibilityRole="header">
            {tr("M-MB-02.title")}
          </Txt>
          <Txt kind="body" color="ink2">
            {tr("M-MB-02.subtitle")}
          </Txt>
        </View>
        <LangBar testID="M-MB-02" glossable={false} />
        <OfflineBar lastCopyAt={st.cachedAt} visible={offline} testID="M-MB-02.offline" />

        {dto.slips.length === 0 ? (
          <EmptyState
            glyph="slip"
            title={tr("M-MB-02.emptyTitle")}
            body={tr("M-MB-02.emptyBody")}
            testID="M-MB-02.empty"
          />
        ) : (
          <View
            {...mm7.rootProps}
            dataSet={{ ...mm7.rootProps.dataSet, trace: traceState(mm7.phase) }}
            style={[styles.list, { backgroundColor: t.color.plate }]}
          >
            <MomentMarker id="MM-7" phase={mm7.phase} />
            {dto.slips.map((s, i) => {
              const f = slipFigures(s, lang);
              return (
                <View key={s.serial}>
                  {i > 0 ? <Rule /> : null}
                  <Pressable
                    ref={(r) => {
                      refs.current[s.serial] = r;
                    }}
                    testID={`M-MB-02.slip.${s.serial}`}
                    accessibilityRole="button"
                    accessibilityLabel={tr("M-MB-02.slipLabel", { serial: s.serial, date: f.date, kg: f.kg })}
                    accessibilityHint={tr("M-MB-01.traceSlips")}
                    onPress={() => open(s.serial)}
                    style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.color.pencilWash }]}
                  >
                    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                      <SlipPaper slip={s} owner={owner} width={88} />
                    </View>
                    <View style={styles.rowText} importantForAccessibility="no-hide-descendants">
                      <Txt kind="bodyStrong">{tr("M-MB-02.slip", { serial: s.serial })}</Txt>
                      <Txt kind="caption" color="ink2">
                        {f.date}
                      </Txt>
                      {demo && f.provisional ? (
                        <Txt kind="caption" color="ink3">
                          {tr("M-MB-02.provisional")}
                        </Txt>
                      ) : null}
                    </View>
                    <Txt kind="figure" importantForAccessibility="no">
                      {f.kg}
                    </Txt>
                    <Glyph name="chevron" size={20} color={t.color.ink3} />
                  </Pressable>
                </View>
              );
            })}
            <View style={[styles.total, { borderTopColor: t.color.ink }]} testID="M-MB-02.total">
              <Txt kind="bodyStrong" style={styles.fill}>
                {tr("M-MB-02.total")}
              </Txt>
              <Txt kind="amountM">{total.kg}</Txt>
            </View>
          </View>
        )}

        {dto.slips.length && !total.matchesLine ? (
          <Banner tone="decide" icon="scale" testID="M-MB-02.totalOff">
            <Txt kind="body">{tr("M-MB-02.totalOff")}</Txt>
          </Banner>
        ) : null}

        {st.review ? (
          <ReviewStatus record={st.review} lang={lang} testID="M-MB-02.request" />
        ) : !st.linkToken ? (
          <Button
            variant="tonal"
            icon="question"
            label={tr("M-MB-02.mismatch")}
            accessibilityHint={tr("M-MB-02.mismatchHint")}
            onPress={() => setRecheck(true)}
            style={styles.start}
            testID="M-MB-02.mismatch"
          />
        ) : null}
        {dto.slips.some((s) => !s.cropUrl) ? (
          <Txt kind="caption" color="ink3">
            {tr("M-MB-02.photoPending")}
          </Txt>
        ) : null}
        <Txt kind="caption" color="ink3">
          {tr("common.syntheticData")}
        </Txt>
      </Screen>

      {zoom ? (
        <SlipZoom
          dto={dto}
          serial={zoom.serial}
          origin={zoom.at}
          lang={lang}
          owner={owner}
          onPhase={mm7.set}
          sources={sources}
          voice={voice}
          autoListen={false}
          onClosed={() => {
            setZoom(null);
            mm7.set("rest");
          }}
        />
      ) : null}

      <Sheet
        visible={recheck}
        title={tr("M-MB-04.recheckTitle")}
        onClose={() => setRecheck(false)}
        testID="M-MB-02.review"
      >
        {st.review ? (
          <ReviewStatus record={st.review} lang={lang} testID="M-MB-02.review.sent" />
        ) : (
          <>
            <Txt kind="body" color="ink2">
              {tr("M-MB-04.recheckBody")}
            </Txt>
            <ReviewFields dto={dto} form={review} testPrefix="M-MB-02.review" />
          </>
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  titles: { gap: space.s4 },
  list: { borderRadius: radius.none },
  row: { flexDirection: "row", alignItems: "center", gap: space.s12, padding: space.s12, minHeight: 80 },
  rowText: { flex: 1, gap: space.s2 },
  total: { flexDirection: "row", alignItems: "center", padding: space.s12, borderTopWidth: 2 },
  start: { alignSelf: "flex-start" },
});
