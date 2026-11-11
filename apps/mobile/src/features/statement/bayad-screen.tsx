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
 *
 * UI gate round 2 (unslop spec §3.11): the statement is the screen, full-bleed on white, not a card in a card. A
 * factual header (her name and one mono line; the greeting is spoken in Paminawa), the amount, a status pill with
 * one mono line and the one honesty tag, one line of prose only when a person acts next, and Paminawa as one large
 * play button. The rail's sentence moves to the fine print at the foot.
 *
 * UI gate round 3 (docs/DESIGN.md): her name, the amount, her kilos and the payment state sit together as one group, with
 * Paminawa right below; the language row follows the reading it changes. The rail is one micro-tag ("Sandbox")
 * beside the PayPal status; her kilos and the expected pay date are one line each, a label and its figure on the
 * label step; the season reads "2026-A"; the time PayPal confirmed is a timestamp in the mono.
 *
 * UI gate round 4 (docs/DESIGN.md §9): the confirmed pill is the 32 px status chip with "05:20 · Simulated" on its
 * row; every block of the statement is a snap row, so the tab bar never rests on half of "CBU R1"; an opened receipt
 * line comes up to 16 px under the top inset (the traced peso's "Inyong bayad" card starts whole).
 *
 * UI gate round 5 (docs/DESIGN.md §10): her whole pay in the first viewport. The header line is "M-014 · 2026-A"; the
 * peso estimate and her kilos share one line; Paminawa is a 48 dp row whose voice reads "Sintetikong tingog" (the
 * provider in the spoken label); her slips appear once (the slip row steps aside while an opened line shows them);
 * history rows lead with 8 px state dots and say one day once; nothing ends on an orphan word.
 */
import { type Href, router, useIsFocused } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Platform, StyleSheet, View, type ViewInstance } from "react-native";
import type { StatementDTO } from "../../_shims/api-client";
import type { Lang } from "../../_shims/contracts";
import { format } from "../../_shims/domain";
import { space } from "../../_shims/tokens.native";
import { seasonLabel, voiceWords } from "../../lib/display";
import { shareFigures, type TraceId } from "../../lib/figures";
import { statementRail } from "../../lib/payout-status";
import { type AudioPlan, audioPlan, glossPairs, MONEY_SLOTS, sentenceFor } from "../../lib/statement";
import { HREF } from "../../services/session";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { focusFirst } from "../../ui/a11y";
import { AmountDisplay } from "../../ui/amount";
import { Screen, SnapRow } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { MicroTag } from "../../ui/honesty";
import { MomentMarker, useMoment } from "../../ui/moment";
import { TIMELINE } from "../../ui/motion";
import { Sheet } from "../../ui/overlay";
import { Banner, Button, Rule, SectionTitle } from "../../ui/primitives";
import { SealView } from "../../ui/seal-view";
import { figures, Sentence } from "../../ui/sentence";
import { EmptyState, OfflineBar, Skeleton } from "../../ui/states";
import { Txt } from "../../ui/text";
import { InviteRing, StatusCapsule, useBayadNa } from "./capsule";
import { DemoTray } from "./demo-tray";
import { historyRows, type LineView, lineView, receiptStates, sealSigners } from "./line-view";
import { ListenButton } from "./listen-button";
import { traceState } from "./mm7";
import { PaminawaPanel, useVoiceLabel } from "./paminawa-panel";
import { COLUMN, GlossedSentence, HistoryMark, LangBar } from "./parts";
import { type ExpandState, listsSlips, ReceiptBar } from "./receipt-bar";
import { ReviewFields, ReviewStatus, useReviewForm } from "./review-form";
import type { SlipOwner } from "./slip-paper";
import { SlipTiles, type TapPoint } from "./slip-tiles";
import { SlipZoom } from "./slip-zoom";
import { useStatement } from "./statement-store";
import { usePhoneVoice } from "./use-paminawa";
import { useT } from "./use-t";

/** "Paminawon una" opens the reading once per launch, not every time she comes back to the tab. */
let autoOpened = false;

/** Sentences the pill, its mono line and the tag already say (round 2: at most one line of prose). */
const QUIET_DETAIL: ReadonlySet<string> = new Set(["M-MB-01.checking", "M-MB-01.sent", "M-MB-01.paid"]);

/** The reading's length, "0:42", when every sentence has a clip with a known duration; otherwise nothing. */
function readingLength(plan: AudioPlan): string | null {
  const ms = plan.steps.map((s) => (s.voice.kind === "clip" ? s.voice.durationMs : null));
  if (!ms.length || ms.some((d) => !d)) return null;
  return format.elapsed(ms.reduce<number>((sum, d) => sum + (d ?? 0), 0));
}

export function ownerOf(dto: StatementDTO): SlipOwner {
  return {
    memberNo: dto.member.memberNo,
    name: dto.member.displayName,
    allGrade1: shareFigures(dto).allGrade1,
    coop: dto.coop.name,
  };
}

/**
 * One fact on one line (round 3): a label in statement ink 2 and its figure in statement ink, both on the label step,
 * the figure never split from itself. "Inyong gidala 148.0 kg"; "Gilauman nga petsa sa bayad 6 Nob 2026".
 */
function Fact({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.fact} testID={testID}>
      <Txt kind="micro" color="statementInk2" style={styles.factLabel}>
        {label}
      </Txt>
      <Txt kind="figure" color="statementInk" style={styles.factValue}>
        {value}
      </Txt>
    </View>
  );
}

/**
 * One line of her history: who acted, what happened, when. A snap row (round 4): whole above the bar, or none.
 * Round 5: the time in the mono (a timestamp), and the day only when her history spans more than one (one day is said
 * once, in the heading), so the words keep the line and never wrap onto an orphan.
 */
function HistoryRow({
  row,
  lang,
  withDay,
}: {
  row: ReturnType<typeof historyRows>[number];
  lang: Lang;
  withDay: boolean;
}) {
  const tr = useT();
  return (
    <SnapRow style={styles.historyRow} dataSet={{ kind: row.kind }}>
      <HistoryMark mark={row.mark} by={row.by} />
      <Txt kind="body" color="statementInk" style={styles.flex}>
        {tr(row.copy.key, row.copy.args)}
      </Txt>
      <Txt kind="hash" color="statementInk2">
        {withDay ? `${format.dayMonth(row.at, lang)} · ${format.time(row.at)}` : format.time(row.at)}
      </Txt>
    </SnapRow>
  );
}

function StatementSkeleton() {
  return (
    <View style={styles.doc}>
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
      <Screen
        testID="M-MB-01"
        state={st.status === "error" ? "error" : "loading"}
        contentStyle={COLUMN}
        surface="plate"
      >
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
  const mm1 = useBayadNa(view.capsule, view.replayed ? null : st.paid, focused);
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
  const railLabel = statementRail(dto, lang, st.track);
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

  const help = sentenceFor(pairs, "HELP");
  const aiNote = sentenceFor(pairs, "AI_NOTE");
  const signers = sealSigners(dto);
  const detail = view.detail ? tr(view.detail.key, view.detail.args) : null;
  // A PayPal line's peso estimate reads "≈ ₱4,028" (round 2); the figure is the estimate's own, untouched, and the
  // spoken label keeps "about … (estimate)". A cash line keeps its one sentence.
  const estimate = view.under && "text" in view.under ? view.under.text : null;
  const peso = estimate ? (/₱[\d,.]+/.exec(estimate)?.[0] ?? null) : null;
  const under = view.under
    ? "text" in view.under
      ? peso
        ? tr("M-MB-01.about", { peso })
        : view.under.text
      : tr(view.under.key, view.under.args)
    : null;
  // Said by the pill, its mono line and the tag; the sentence stays in the block's spoken label.
  const saysMore = !!view.detail && !QUIET_DETAIL.has(view.detail.key);
  const when = view.capsule === "paid" && !view.replayed && view.paidAt ? format.time(view.paidAt) : null;
  const length = readingLength(plan);
  const paypalLine = view.payKind === "paypal";
  // The rail's honesty mark (round 3): one micro-tag, "Sandbox" beside the dashed circle, whose label is the rail's
  // whole words ("Simulated PayPal sandbox", or replayed). A rail of unknown origin is not simulated: it says so in
  // words, with no tag. One per statement.
  const railTag =
    railLabel.kind === "unknown" ? (
      <Txt kind="micro" color="statementInk2" testID="M-MB-01.rail" dataSet={{ rail: railLabel.kind }}>
        {railLabel.chip}
      </Txt>
    ) : (
      <MicroTag testID="M-MB-01.rail" dataSet={{ rail: railLabel.kind }} label={railLabel.chip} />
    );
  const kilos = format.kg(dto.kilos.netGrams);
  // Without a signal, what is on screen is the last copy, whether it came from this session or from the phone.
  const offline = !online;
  const state = offline ? "offline" : view.capsule;
  const rows = historyRows(dto, st.track);
  // Round 5: a history on one day says the day once, in its heading ("Kasaysayan · 11 Nob").
  const days = new Set(rows.map((r) => format.dayMonth(r.at, lang)));
  const historyDay = days.size === 1 ? ([...days][0] ?? null) : null;
  const trace = traceState(mm7.phase);

  const amountLabel =
    view.showAmount && view.hero
      ? [view.hero.spoken, `${tr("M-MB-01.kilosLabel")} ${kilos}`, view.word, detail]
          .filter(Boolean)
          .join(". ")
      : [tr("M-MB-01.kilosLabel"), kilos, view.word, detail].filter(Boolean).join(". ");

  return (
    <View style={styles.fill}>
      <Screen testID="M-MB-01" state={state} contentStyle={COLUMN} surface="plate">
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

        <View style={styles.doc} testID="M-MB-01.card">
          {/* Round 3: one group from her name to the payment state, Paminawa right below it. */}
          <View style={styles.lead}>
            <View style={styles.group}>
              {/* 1. A factual header (round 2): her name as the registry addresses her, then one data line. The
              greeting itself is spoken in Paminawa. */}
              <SnapRow style={styles.head} testID="M-MB-01.greeting">
                <Txt kind="statementName" color="statementInk" accessibilityRole="header">
                  {dto.member.nameByLang[lang]}
                </Txt>
                <Txt kind="micro" color="statementInk2" testID="M-MB-01.season">
                  {tr("M-MB-01.headMeta", {
                    no: dto.member.memberNo,
                    season: seasonLabel(dto.season.code),
                  })}
                </Txt>
                {/* A cash line shows no PayPal value: the rail's tag covers the statement, under its header. */}
                {paypalLine ? null : railTag}
              </SnapRow>

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
                    <SnapRow style={styles.amount}>
                      <AmountDisplay
                        testID="M-MB-01.amount"
                        text={view.hero.amount}
                        srLabel={view.hero.spoken}
                        state={view.amountState}
                        fill={view.fillsOnPress ? mm1.fill : undefined}
                      />
                      {/* Round 5: a PayPal line's peso estimate and her kilos share one line under the amount
                          ("≈ ₱4,028   Inyong gidala 148.0 kg"), so her whole pay rests in the first viewport; a cash
                          line's sentence keeps its own line. */}
                      <View style={peso ? styles.facts : styles.amount}>
                        {under ? (
                          <Sentence
                            kind={peso ? "figure" : "statementBody"}
                            color="statementInk2"
                            lang={lang}
                            segments={figures(under)}
                            testID="M-MB-01.under"
                          />
                        ) : null}
                        {/* Round 3: her kilos beside her pay, not at the foot of the receipt. */}
                        <Fact label={tr("M-MB-01.kilosLabel")} value={kilos} testID="M-MB-01.kilosFact" />
                      </View>
                    </SnapRow>
                  ) : (
                    <SnapRow style={styles.amount} testID="M-MB-01.kilos">
                      <Txt kind="label" color="statementInk2">
                        {tr("M-MB-01.kilosLabel")}
                      </Txt>
                      {/* Round 2: her own kilos are never faded to say "held"; the pill below says it. */}
                      <Txt kind="amountL" color="statementInk">
                        {kilos}
                      </Txt>
                      {dto.expectedDate ? (
                        <Fact
                          label={tr("M-MB-01.expectedLabel")}
                          value={format.date(dto.expectedDate, lang)}
                          testID="M-MB-01.expected"
                        />
                      ) : null}
                    </SnapRow>
                  )}
                  {/* 3. The status pill (MM-1 plays here) and, on its row, the time and the tag that covers it (round
                      4: "05:20 · Simulated" 8 px to the pill's right, never a line of its own). */}
                  <SnapRow style={styles.status}>
                    <View {...mm1.rootProps}>
                      <StatusCapsule view={view} mm1={mm1} testID="M-MB-01.capsule" />
                    </View>
                    {when || paypalLine ? (
                      <View style={styles.meta}>
                        {when ? (
                          <Txt kind="hash" color="statementInk2" testID="M-MB-01.when">
                            {when}
                          </Txt>
                        ) : null}
                        {when && paypalLine ? (
                          <Txt kind="hash" color="statementInk2" aria-hidden>
                            ·
                          </Txt>
                        ) : null}
                        {paypalLine ? railTag : null}
                      </View>
                    ) : null}
                  </SnapRow>
                  {/* The one line of prose, only when a person acts next or something is not what it seems. */}
                  {detail && saysMore ? (
                    <Sentence
                      kind="statementBody"
                      color="statementInk"
                      lang={lang}
                      segments={figures(detail)}
                      testID="M-MB-01.detail"
                    />
                  ) : null}
                </View>
              </View>
            </View>

            {/* Paminawa: the second focus, one large play button. */}
            <SnapRow style={styles.listen}>
              {/* The reading's length and its voice, as one data line ("0:42 · synthetic voice"). */}
              <ListenButton
                testID="M-MB-01.paminawa"
                label={tr("M-MB-01.paminawa")}
                srLabel={`${tr("M-MB-01.paminawaHint")}. ${voiceLabel ?? ""}`}
                // Round 5: "1:29 · Sintetikong tingog"; the provider ("Gemini TTS") stays in the spoken label.
                meta={
                  [length, voiceLabel ? voiceWords(voiceLabel) : null].filter(Boolean).join(" · ") || null
                }
                metaTestID="M-MB-01.voice"
                onPress={() => (readOnly ? setListening(true) : router.push(HREF.paminawa))}
                ring={<InviteRing mm1={mm1} round />}
              />
            </SnapRow>
            {/* The language row follows the reading it changes (round 3: the statement opens on her name). */}
            <SnapRow>
              <LangBar testID="M-MB-01" />
            </SnapRow>
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

          {/* 5. Her slips, then the history. Round 5: her receipts appear once a screen; while an opened line shows
              them (the traced peso, the premium, the bonus, a credit), this row steps aside. */}
          {dto.slips.length && !(open?.state === "expanded" && listsSlips(open.id)) ? (
            <SnapRow style={styles.section}>
              <SectionTitle>{tr("M-MB-01.slips")}</SectionTitle>
              <SlipTiles slips={dto.slips} owner={owner} onOpen={openSlip} testPrefix="M-MB-01.chip" />
            </SnapRow>
          ) : null}

          {rows.length ? (
            <View testID="M-MB-01.history" style={styles.history}>
              {/* Round 4: the heading never rests alone above the bar: it is one snap row with the first row. */}
              <SnapRow style={styles.section}>
                <SectionTitle>
                  {historyDay ? `${tr("M-MB-01.history")} · ${historyDay}` : tr("M-MB-01.history")}
                </SectionTitle>
                {rows.slice(0, 1).map((h) => (
                  <HistoryRow key={`${h.kind}-${h.at}`} row={h} lang={lang} withDay={!historyDay} />
                ))}
              </SnapRow>
              {rows.length > 1 ? (
                <View style={styles.history}>
                  {rows.slice(1).map((h) => (
                    <HistoryRow key={`${h.kind}-${h.at}`} row={h} lang={lang} withDay={!historyDay} />
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {/* 6. The seal and the rate card, and how AI was involved. */}
          <Rule />
          <SnapRow style={styles.footer} testID="M-MB-01.footer">
            {/* Round 6: a signed batch shows its seal; before that the rate card's row leads with the lock the console's
                Rate card row wears (never an empty ring). */}
            {dto.batchSha256 && signers ? (
              <SealView batchSha256={dto.batchSha256} size={48} keys={2} engrave={false} />
            ) : (
              <Glyph name="lock" size={16} color={t.color.statementInk2} />
            )}
            <View style={[styles.flex, styles.footerWords]}>
              {signers ? (
                <Txt kind="caption" color="statementInk2">
                  {tr("M-MB-01.sealCaption", { a: signers[0], b: signers[1] })}
                </Txt>
              ) : null}
              <Txt kind="micro" color="statementInk2">
                {tr("M-MB-01.rateCardId", { hash: format.hash(dto.rateCard.sha256, 2) })}
              </Txt>
              <Txt kind="micro" color="statementInk2">
                {tr("M-MB-01.rateCardBoard", { date: format.date(dto.rateCard.ratifiedAt, lang) })}
              </Txt>
            </View>
          </SnapRow>
          {aiNote ? (
            <SnapRow style={styles.aiNote}>
              <Glyph name="pencil" size={16} color={t.color.statementInk2} />
              <View style={styles.flex}>
                <GlossedSentence pair={aiNote} lang={lang} gloss={st.gloss} kind="body" color="ink2" />
              </View>
            </SnapRow>
          ) : null}

          {/* 7. Who to ask, always last. */}
          <Rule />
          <View style={styles.ask} testID="M-MB-01.ask">
            {help ? (
              <SnapRow>
                <GlossedSentence pair={help} lang={lang} gloss={st.gloss} kind="body" />
              </SnapRow>
            ) : null}
            <SnapRow style={styles.rights}>
              <Txt kind="body" color="statementInk">
                {tr("M-MB-04.rights")}
              </Txt>
              <Txt kind="micro" color="statementInk2">
                {tr("M-MB-04.rightsCite")}
              </Txt>
            </SnapRow>
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

        {/* The fine print: the rail in one sentence (what the tag above stands for), and the synthetic data. */}
        <SnapRow style={styles.fine}>
          <Txt kind="caption" color="statementInk2" testID="M-MB-01.railCopy">
            {railLabel.copy}
          </Txt>
          <Txt kind="caption" color="statementInk2">
            {tr("common.syntheticData")}
          </Txt>
        </SnapRow>
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
  /** Full-bleed on the white screen (round 2): no card, no shadow; sections 32 apart. */
  doc: { gap: space.s32 },
  /** Name, amount, kilos and state, then Paminawa and the language row: tight inside, 24 to the reading. */
  lead: { gap: space.s24 },
  group: { gap: space.s16 },
  head: { gap: space.s4 },
  amountBlock: { gap: space.s16 },
  amount: { gap: space.s4 },
  /** The peso estimate and her kilos on one line under the amount (round 5), wrapping only on a narrow column. */
  facts: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: space.s16,
    rowGap: space.s4,
  },
  /** The pill and its time and tag on one row; a narrow column wraps the tag under the pill. */
  status: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s8,
    rowGap: space.s4,
  },
  meta: { flexDirection: "row", alignItems: "center", gap: space.s4 + 2 },
  listen: { gap: space.s12 },
  section: { gap: space.s12 },
  /** One fact on one line: the label shrinks first, the figure never splits. */
  fact: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: space.s8 },
  factLabel: { flexShrink: 1 },
  factValue: { flexShrink: 0 },
  history: { gap: space.s8 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: space.s8, minHeight: 32 },
  footer: { flexDirection: "row", alignItems: "center", gap: space.s12 },
  footerWords: { gap: space.s2 },
  aiNote: { flexDirection: "row", alignItems: "flex-start", gap: space.s8 },
  ask: { gap: space.s12 },
  rights: { gap: space.s2 },
  recheck: { alignSelf: "flex-start" },
  fine: { gap: space.s8 },
});
