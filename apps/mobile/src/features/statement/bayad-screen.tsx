/**
 * M-MB-01 Bayad, the member's statement (S1.9; design §6 M1): the white original copy, square-cornered. Money first,
 * audio second, then the receipt, her slips, the history, the seal, and who to ask, always last (WCAG 3.2.6).
 *
 * - The amount block takes first accessibility focus and Paminawa second (S1.9).
 * - The amount follows the amount grammar (S2.2.1): hollow while the money is with PayPal or due at the bodega,
 *   landed only when a verified `item.updated` says PayPal confirmed it (MM-1), attested when the clerk records the
 *   cash. A line still being checked has no amount yet: her kilos, slips and the expected date stand in. A line
 *   whose receipt does not add up on this phone stays hollow, says so, and names who checks it (I3,
 *   `data-conserved`).
 * - Every amount on the receipt can be tapped (MM-7): it opens to where it comes from, down to the slip in the
 *   clerk's hand.
 * - "Paminawon una": the reading opens and starts by itself once per launch, never under TalkBack.
 * - The `/s/:token` link shows the same statement read only (no demo controls, no re-check, no autoplay).
 */
import { type Href, router, useIsFocused } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Platform, StyleSheet, View, type ViewInstance } from "react-native";
import type { StatementDTO } from "../../_shims/api-client";
import type { Lang } from "../../_shims/contracts";
import { format } from "../../_shims/domain";
import { radius, space, target } from "../../_shims/tokens.native";
import { shareFigures, type TraceId } from "../../lib/figures";
import { type AudioPlan, audioPlan, glossPairs, MONEY_SLOTS, sentenceFor } from "../../lib/statement";
import { HREF } from "../../services/session";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { focusFirst } from "../../ui/a11y";
import { AmountDisplay } from "../../ui/amount";
import { Screen } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { MomentMarker, useMoment } from "../../ui/moment";
import { TIMELINE } from "../../ui/motion";
import { Sheet } from "../../ui/overlay";
import { Banner, Button, Rule, SectionTitle } from "../../ui/primitives";
import { SealView } from "../../ui/seal-view";
import { figures, Sentence } from "../../ui/sentence";
import { Slab } from "../../ui/slab";
import { EmptyState, OfflineBar, Skeleton } from "../../ui/states";
import { Txt } from "../../ui/text";
import { InviteRing, StatusCapsule, useBayadNa } from "./capsule";
import { DemoTray } from "./demo-tray";
import { historyRows, type LineView, lineView, receiptStates, sealSigners } from "./line-view";
import { statementRail } from "./live";
import { traceState } from "./mm7";
import { PaminawaPanel, useVoiceLabel } from "./paminawa-panel";
import { COLUMN, GlossedSentence, HistoryMark, LangBar } from "./parts";
import { type ExpandState, ReceiptBar } from "./receipt-bar";
import { ReviewFields, ReviewStatus, useReviewForm } from "./review-form";
import type { SlipOwner } from "./slip-paper";
import { SlipTiles, type TapPoint } from "./slip-tiles";
import { SlipZoom } from "./slip-zoom";
import { useStatement } from "./statement-store";
import { usePhoneVoice } from "./use-paminawa";
import { useT } from "./use-t";

/** "Paminawon una" opens the reading once per launch, not every time she comes back to the tab. */
let autoOpened = false;

export function ownerOf(dto: StatementDTO): SlipOwner {
  return {
    memberNo: dto.member.memberNo,
    name: dto.member.displayName,
    allGrade1: shareFigures(dto).allGrade1,
    coop: dto.coop.name,
  };
}

function StatementSkeleton() {
  const { t } = useFs();
  return (
    <View style={[styles.card, { backgroundColor: t.color.plate }]}>
      <Skeleton lines={2} />
      <Skeleton lines={0} block={56} />
      <Skeleton lines={0} block={64} />
      <Skeleton lines={4} />
    </View>
  );
}

export function BayadScreen({ readOnlyUntil }: { readOnlyUntil?: string } = {}) {
  const { lang, demo, online, listenFirst } = useApp();
  const { motion } = useFs();
  const tr = useT();
  const st = useStatement();
  const { dto, capsule } = st;

  if (!dto || !capsule) {
    return (
      <Screen testID="M-MB-01" state={st.status === "error" ? "error" : "loading"} contentStyle={COLUMN}>
        <LangBar testID="M-MB-01" />
        {st.status === "error" ? (
          <EmptyState
            glyph="wifiOff"
            title={tr("M-MB-01.loadFailed")}
            body={tr("M-MB-01.loadFailedBody")}
            testID="M-MB-01.error"
            action={
              <Button
                variant="tonal"
                icon="refresh"
                label={tr("common.tryAgain")}
                onPress={() => void st.reload()}
                testID="M-MB-01.retry"
              />
            }
          />
        ) : (
          <StatementSkeleton />
        )}
      </Screen>
    );
  }

  return (
    <Statement
      dto={dto}
      view={lineView(dto, capsule, st.track, lang)}
      lang={lang}
      readOnlyUntil={readOnlyUntil ?? null}
      demoOn={!!demo && !st.linkToken}
      online={online}
      listenFirst={listenFirst === true && !motion.screenReader && !st.linkToken && Platform.OS !== "web"}
    />
  );
}

function Statement({
  dto,
  view,
  lang,
  readOnlyUntil,
  demoOn,
  online,
  listenFirst,
}: {
  dto: StatementDTO;
  view: LineView;
  lang: Lang;
  readOnlyUntil: string | null;
  demoOn: boolean;
  online: boolean;
  listenFirst: boolean;
}) {
  const { demo } = useApp();
  const { t } = useFs();
  const tr = useT();
  const st = useStatement();
  const focused = useIsFocused();
  const mm1 = useBayadNa(view.capsule, st.paid, focused);
  const mm7 = useMoment("MM-7", "rest");
  const [open, setOpen] = useState<{ id: TraceId; state: ExpandState } | null>(null);
  const [zoom, setZoom] = useState<{ serial: string; at: TapPoint } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const amountRef = useRef<ViewInstance>(null);
  const owner = useMemo(() => ownerOf(dto), [dto]);
  const readOnly = readOnlyUntil !== null;

  const rail = view.payKind;
  const exclude = view.showAmount ? undefined : MONEY_SLOTS;
  const pairs = useMemo(() => glossPairs(dto, lang, rail, exclude), [dto, lang, rail, exclude]);
  const voice = usePhoneVoice(lang);
  const plan: AudioPlan = useMemo(
    () => audioPlan(dto, lang, { deviceVoice: !!voice, rail, exclude, playable: () => online }),
    [dto, lang, voice, rail, exclude, online],
  );
  const sources = useMemo<AudioPlan>(() => {
    const step = plan.steps.find((s) => s.slot === "SOURCES");
    return { mode: plan.mode, steps: step ? [{ ...step, index: 0 }] : [] };
  }, [plan]);
  const voiceLabel = useVoiceLabel(plan, voice, lang);
  const review = useReviewForm(dto, st.recordReview);

  // S1.9: the amount block takes first accessibility focus, Paminawa second.
  useEffect(() => focusFirst(amountRef), []);

  // "Paminawon una": reading starts when the statement opens, once per launch, never under TalkBack.
  useEffect(() => {
    if (!listenFirst || autoOpened || readOnly) return;
    autoOpened = true;
    router.push({ pathname: HREF.paminawa, params: { auto: "1" } } as Href);
  }, [listenFirst, readOnly]);

  // MM-7: a tap frames the figure (90 ms), then the line opens in place.
  const onSegment = (id: TraceId) => {
    mm7.timers.clear();
    if (open?.id === id) {
      setOpen(null);
      mm7.set("rest");
      return;
    }
    setOpen({ id, state: "framed" });
    mm7.set("framed");
    mm7.timers.at(TIMELINE["MM-7"].frameMs, () => {
      setOpen({ id, state: "expanded" });
      mm7.set("expanded");
    });
  };
  const openSlip = (serial: string, at: TapPoint) => setZoom({ serial, at });

  const greeting = sentenceFor(pairs, "GREETING");
  const help = sentenceFor(pairs, "HELP");
  const aiNote = sentenceFor(pairs, "AI_NOTE");
  const signers = sealSigners(dto);
  const detail = view.detail ? tr(view.detail.key, view.detail.args) : null;
  const under = view.under
    ? "text" in view.under
      ? view.under.text
      : tr(view.under.key, view.under.args)
    : null;
  // Without a signal, what is on screen is the last copy, whether it came from this session or from the phone.
  const offline = !online;
  const state = offline ? "offline" : view.capsule;
  const rows = historyRows(dto, st.track);
  const trace = traceState(mm7.phase);

  const amountLabel =
    view.showAmount && view.hero
      ? [view.hero.spoken, view.word, detail].filter(Boolean).join(". ")
      : [tr("M-MB-01.kilosLabel"), format.kg(dto.kilos.netGrams), view.word, detail]
          .filter(Boolean)
          .join(". ");

  return (
    <View style={styles.fill}>
      <Screen testID="M-MB-01" state={state} contentStyle={COLUMN}>
        <LangBar testID="M-MB-01" />
        {readOnlyUntil ? (
          <Banner icon="lock" testID="M-MB-01.readOnly">
            <Txt kind="body">{tr("M-MB-01.linkReadOnly", { date: format.date(readOnlyUntil, lang) })}</Txt>
          </Banner>
        ) : null}
        <OfflineBar lastCopyAt={st.cachedAt} visible={offline} testID="M-MB-01.offline" />
        {online && st.refreshFailed && st.cachedAt ? (
          <Banner
            tone="decide"
            icon="refresh"
            testID="M-MB-01.stale"
            action={<Button variant="text" label={tr("common.tryAgain")} onPress={() => void st.reload()} />}
          >
            <Txt kind="body">{tr("M-MB-01.stale", { time: format.time(st.cachedAt) })}</Txt>
          </Banner>
        ) : null}

        <View style={[styles.card, { backgroundColor: t.color.plate }]} testID="M-MB-01.card">
          <View testID="M-MB-01.rail" dataSet={{ rail: statementRail(dto, lang).kind }}>
            <Txt kind="label">{statementRail(dto, lang).chip}</Txt>
          </View>
          <Txt kind="caption" color="ink2" testID="M-MB-01.railCopy">
            {statementRail(dto, lang).copy}
          </Txt>
          {/* 1. The co-op and the season, then the greeting by her registry honorific. */}
          <View style={styles.head}>
            <Txt kind="label" color="ink2">
              {dto.coop.name}
            </Txt>
            <Txt kind="caption" color="ink3">
              {tr("M-MB-01.season", { code: dto.season.code })}
            </Txt>
          </View>
          {greeting ? (
            <GlossedSentence
              pair={greeting}
              lang={lang}
              gloss={st.gloss}
              kind="statementLead"
              testID="M-MB-01.greeting"
            />
          ) : null}

          {/* 2. Money first: one block for the screen reader, with the status and what happens next. */}
          <View
            ref={amountRef}
            collapsable={false}
            accessible
            accessibilityRole="summary"
            accessibilityLabel={amountLabel}
            accessibilityLiveRegion="polite"
            style={styles.amountBlock}
            testID="M-MB-01.amountBlock"
            dataSet={{ conserved: view.conserved ? "true" : "false" }}
          >
            <View
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
              style={styles.amountBlock}
            >
              {view.showAmount && view.hero ? (
                <View style={styles.amount}>
                  <AmountDisplay
                    testID="M-MB-01.amount"
                    text={view.hero.amount}
                    srLabel={view.hero.spoken}
                    state={view.amountState}
                    fill={view.fillsOnPress ? mm1.fill : undefined}
                  />
                  {under ? (
                    <Sentence
                      kind="statementBody"
                      color="ink2"
                      lang={lang}
                      segments={figures(under)}
                      testID="M-MB-01.under"
                    />
                  ) : null}
                </View>
              ) : (
                <View style={styles.amount} testID="M-MB-01.kilos">
                  <Txt kind="label" color="ink2">
                    {tr("M-MB-01.kilosLabel")}
                  </Txt>
                  <Txt kind="amountL" color="pencil">
                    {format.kg(dto.kilos.netGrams)}
                  </Txt>
                  {dto.expectedDate ? (
                    <Sentence
                      kind="statementBody"
                      color="ink2"
                      lang={lang}
                      segments={figures(
                        tr("M-MB-01.expected", { date: format.date(dto.expectedDate, lang) }),
                      )}
                    />
                  ) : null}
                </View>
              )}
              {/* 3. The status capsule; MM-1 plays here. */}
              <View {...mm1.rootProps}>
                <StatusCapsule view={view} mm1={mm1} testID="M-MB-01.capsule" />
              </View>
              {detail ? (
                <Sentence
                  kind="statementBody"
                  lang={lang}
                  segments={figures(detail)}
                  testID="M-MB-01.detail"
                />
              ) : null}
            </View>
          </View>

          {/* Paminawa: the second focus, 64 dp. */}
          <View style={styles.listen}>
            <View collapsable={false}>
              <Slab
                testID="M-MB-01.paminawa"
                label={tr("M-MB-01.paminawa")}
                icon="listen"
                depth="d1"
                tone="chalk"
                height={target.hero}
                srLabel={`${tr("M-MB-01.paminawaHint")}. ${voiceLabel ?? ""}`}
                onCommit={() => (readOnly ? setListening(true) : router.push(HREF.paminawa))}
              />
              <InviteRing mm1={mm1} />
            </View>
            {voiceLabel ? (
              <View style={styles.voice}>
                <Glyph name={plan.mode === "text-only" ? "info" : "listen"} size={16} color={t.color.ink2} />
                <Txt kind="caption" color="ink2" style={styles.flex} testID="M-MB-01.voice">
                  {voiceLabel}
                </Txt>
              </View>
            ) : null}
          </View>

          {/* 4. The receipt; every amount traces to its source (MM-7). */}
          {view.showAmount ? (
            <View
              {...mm7.rootProps}
              dataSet={{ ...mm7.rootProps.dataSet, trace }}
              collapsable={false}
              style={styles.section}
            >
              <MomentMarker id="MM-7" phase={mm7.phase} />
              <ReceiptBar
                dto={dto}
                lang={lang}
                paypal={view.payKind === "paypal"}
                open={open}
                onSegment={onSegment}
                onSlip={openSlip}
                owner={owner}
                states={receiptStates(view)}
              />
            </View>
          ) : null}

          {/* 5. Her slips, then the history. */}
          {dto.slips.length ? (
            <View style={styles.section}>
              <SectionTitle>{tr("M-MB-01.slips")}</SectionTitle>
              <SlipTiles slips={dto.slips} owner={owner} onOpen={openSlip} testPrefix="M-MB-01.chip" />
              <Txt kind="figureS" color="ink2">
                {tr("M-MB-01.slipsTotal", { kg: format.kg(dto.slips.reduce((s, x) => s + x.netGrams, 0)) })}
              </Txt>
            </View>
          ) : null}

          {rows.length ? (
            <View testID="M-MB-01.history" style={styles.section}>
              <SectionTitle>{tr("M-MB-01.history")}</SectionTitle>
              <View style={styles.history}>
                {rows.map((h) => (
                  <View key={`${h.kind}-${h.at}`} style={styles.historyRow} dataSet={{ kind: h.kind }}>
                    <HistoryMark mark={h.mark} by={h.by} />
                    <Txt kind="body" style={styles.flex}>
                      {tr(h.copy.key, h.copy.args)}
                    </Txt>
                    <Txt kind="figureS" color="ink2">
                      {`${format.dayMonth(h.at, lang)} ${format.time(h.at)}`}
                    </Txt>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* 6. The seal and the rate card, and how AI was involved. */}
          <Rule />
          <View style={styles.footer} testID="M-MB-01.footer">
            {dto.batchSha256 ? (
              <SealView batchSha256={dto.batchSha256} size={56} keys={signers ? 2 : 0} engrave={false} />
            ) : null}
            <View style={styles.flex}>
              {signers ? (
                <Txt kind="caption" color="ink2">
                  {tr("M-MB-01.sealCaption", { a: signers[0], b: signers[1] })}
                </Txt>
              ) : null}
              <Txt kind="caption" color="ink2">
                {tr("M-MB-01.rateCard", {
                  hash: format.hash(dto.rateCard.sha256, 2),
                  date: format.date(dto.rateCard.ratifiedAt, lang),
                })}
              </Txt>
            </View>
          </View>
          {aiNote ? (
            <View style={styles.aiNote}>
              <Glyph name="pencil" size={18} color={t.color.pencil} />
              <View style={styles.flex}>
                <GlossedSentence pair={aiNote} lang={lang} gloss={st.gloss} kind="body" color="ink2" />
              </View>
            </View>
          ) : null}

          {/* 7. Who to ask, always last. */}
          <Rule />
          <View style={styles.ask} testID="M-MB-01.ask">
            {help ? <GlossedSentence pair={help} lang={lang} gloss={st.gloss} /> : null}
            <View style={styles.rights}>
              <Txt kind="statementBody">{tr("M-MB-04.rights")}</Txt>
              <Txt kind="caption" color="ink3">
                {tr("M-MB-04.rightsCite")}
              </Txt>
            </View>
            {st.review ? (
              <ReviewStatus record={st.review} lang={lang} testID="M-MB-01.request" />
            ) : !readOnly ? (
              <Button
                variant="text"
                icon="question"
                label={tr("M-MB-01.recheck")}
                onPress={() => setReviewOpen(true)}
                style={styles.recheck}
                testID="M-MB-01.recheck"
              />
            ) : null}
          </View>
        </View>

        <Txt kind="caption" color="ink3">
          {tr("common.syntheticData")}
        </Txt>
        {demoOn && demo ? <DemoTray demo={demo} /> : null}
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
          autoListen={listenFirst}
          onClosed={() => {
            setZoom(null);
            mm7.set(open?.state === "expanded" ? "expanded" : "rest");
          }}
        />
      ) : null}

      <Sheet
        visible={reviewOpen}
        title={tr("M-MB-04.recheckTitle")}
        onClose={() => setReviewOpen(false)}
        testID="M-MB-01.review"
      >
        {st.review ? (
          <ReviewStatus record={st.review} lang={lang} testID="M-MB-01.review.sent" />
        ) : (
          <>
            <Txt kind="body" color="ink2">
              {tr("M-MB-04.recheckBody")}
            </Txt>
            <ReviewFields dto={dto} form={review} testPrefix="M-MB-01.review" />
          </>
        )}
      </Sheet>

      {readOnly ? (
        <Modal
          visible={listening}
          animationType={Platform.OS === "web" ? "none" : "slide"}
          onRequestClose={() => setListening(false)}
          statusBarTranslucent
        >
          {listening ? <PaminawaPanel onClose={() => setListening(false)} /> : null}
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  card: { padding: space.s16, gap: space.s24, borderRadius: radius.none },
  head: { gap: space.s2 },
  amountBlock: { gap: space.s16 },
  amount: { gap: space.s4 },
  listen: { gap: space.s8 },
  voice: { flexDirection: "row", alignItems: "center", gap: space.s8 },
  section: { gap: space.s8 },
  history: { gap: space.s8 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: space.s12, minHeight: 32 },
  footer: { flexDirection: "row", alignItems: "center", gap: space.s12 },
  aiNote: { flexDirection: "row", alignItems: "flex-start", gap: space.s8 },
  ask: { gap: space.s12 },
  rights: { gap: space.s2 },
  recheck: { alignSelf: "flex-start" },
});
