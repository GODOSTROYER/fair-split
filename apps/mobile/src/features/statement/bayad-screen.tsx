/**
 * M-MB-01 Bayad, the member's statement: the white original copy, square-cornered. Money first, audio second,
 * then the receipt, her slips, the history and who to ask (design §6 M1, S1.8). MM-1 and MM-7 play here.
 */
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  StyleSheet,
  View,
  type ViewInstance,
} from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { LANGS } from "../../_shims/contracts";
import { format } from "../../_shims/domain";
import { translate } from "../../_shims/i18n";
import { radius, space, target } from "../../_shims/tokens.native";
import { amountIsSolid } from "../../lib/item-status";
import { statementSentences } from "../../lib/statement";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { AmountDisplay } from "../../ui/amount";
import { Screen } from "../../ui/chrome";
import {
  Banner,
  Button,
  Chip,
  InkStamp,
  MachineTranslatedNote,
  Rule,
  SectionTitle,
} from "../../ui/primitives";
import { SealView } from "../../ui/seal-view";
import { figures, Sentence } from "../../ui/sentence";
import { Slab } from "../../ui/slab";
import { Txt, useT } from "../../ui/text";
import { StatusCapsule, useMoment1 } from "./capsule";
import { type Mm7Phase, ReceiptBar, type SegmentId } from "./receipt-bar";
import { SlipChips } from "./slip-chips";
import { SlipZoom } from "./slip-zoom";
import { useStatement } from "./use-statement";

export function BayadScreen({ linkToken }: { linkToken?: string } = {}) {
  const { lang, setLang, demo, online } = useApp();
  const { t, motion } = useFs();
  const tr = useT();
  const { dto, capsule, track, paid, fromCache, cachedAt, error, reload } = useStatement({ linkToken });
  const mm1 = useMoment1(capsule, paid);
  const [expanded, setExpanded] = useState<SegmentId | null>(null);
  const [mm7, setMm7] = useState<Mm7Phase>("rest");
  const [zoom, setZoom] = useState<{ serial: string; x: number; y: number } | null>(null);
  const paminawaRef = useRef<ViewInstance>(null);

  // Paminawa takes first focus for members flagged audio-first (elderly or thumbmark), design §8.
  useEffect(() => {
    if (!dto?.member.audioFirst || !motion.screenReader || Platform.OS === "web") return;
    const node = findNodeHandle(paminawaRef.current);
    if (node) setTimeout(() => AccessibilityInfo.setAccessibilityFocus(node), 400);
  }, [dto?.member.audioFirst, motion.screenReader]);

  const invite = useAnimatedStyle(() => ({ opacity: mm1.invite.get() }));

  if (!dto || !capsule) {
    return (
      <Screen testID="M-MB-01" state={error ? "error" : "loading"}>
        {error ? (
          <Banner
            tone="decide"
            icon="wifiOff"
            action={<Button variant="text" label={tr("common.tryAgain")} onPress={() => void reload()} />}
          >
            <Txt kind="body">{tr("M-ON-01.pair.offline")}</Txt>
          </Banner>
        ) : (
          <View style={[styles.card, { backgroundColor: t.color.plate, minHeight: 420 }]} />
        )}
      </Screen>
    );
  }

  const { sentences } = statementSentences(dto, lang);
  const lead = sentences.find((s) => s.id === "s1")?.segments ?? [];
  const ask = sentences.find((s) => s.id === "s7")?.segments ?? [];
  const sent = dto.history.find((h) => h.kind === "sent")?.at ?? null;
  const paidAt =
    track.status === "SUCCESS"
      ? (track.updatedAt ?? dto.history.find((h) => h.kind === "paid")?.at ?? null)
      : null;
  const solid = amountIsSolid(capsule);
  const showAmount = capsule !== "checking" && capsule !== "held-line";
  const state = !online && fromCache ? "offline" : capsule;

  const onSegment = (id: SegmentId) => {
    if (id !== "premium") return;
    if (expanded === id) {
      setExpanded(null);
      setMm7("rest");
      return;
    }
    setMm7("framed");
    setExpanded(id);
    setTimeout(() => setMm7("expanded"), motion.reduced ? 0 : 90);
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen testID="M-MB-01" state={state}>
        <View style={styles.langRow} accessibilityRole="radiogroup">
          {LANGS.map((l) => (
            <Chip
              key={l}
              label={translate(l, "M-ON-01.lang.name")}
              selected={l === lang}
              onPress={() => setLang(l)}
              testID={`M-MB-01.lang.${l}`}
            />
          ))}
        </View>

        {!online && fromCache && cachedAt ? (
          <Banner icon="wifiOff" testID="M-MB-01.offline">
            <Txt kind="body">{tr("M-MB-01.offlineCopy", { time: format.time(cachedAt) })}</Txt>
          </Banner>
        ) : null}

        <View
          style={[styles.card, { backgroundColor: t.color.plate }]}
          testID="moment-MM-1"
          dataSet={{ moment: "MM-1", momentPhase: mm1.phase }}
        >
          <View collapsable={false} testID={`moment-MM-1-phase-${mm1.phase}`} style={styles.marker} />
          <View style={{ gap: space.s2 }}>
            <Txt kind="label" color="ink2">
              {dto.coop.name}
            </Txt>
            <Txt kind="caption" color="ink3">
              {tr("M-MB-01.season", { code: dto.season.code })}
            </Txt>
          </View>

          <Sentence segments={lead} kind="statementLead" lang={lang} testID="M-MB-01.greeting" />

          {showAmount ? (
            <View style={{ gap: space.s4 }}>
              <AmountDisplay
                testID="M-MB-01.amount"
                text={format.usd(dto.amounts.netCents)}
                srLabel={format.amountSpoken(dto.amounts.netCents, dto.fx.phpPerUsd)}
                solid={solid}
                fill={capsule === "paid" || capsule === "sent" ? mm1.fill : undefined}
              />
              <Txt kind="statementBody" color="ink2">
                {format.pesoEstimate(dto.amounts.netCents, dto.fx.phpPerUsd, lang)}
              </Txt>
            </View>
          ) : (
            <View style={{ gap: space.s4 }}>
              <Sentence
                lang={lang}
                segments={figures(
                  tr(capsule === "held-line" ? "M-MB-01.heldDetail" : "M-MB-01.checkingDetail", {
                    name: dto.treasurer.first,
                    date: dto.expectedDate ? format.date(dto.expectedDate, lang) : "",
                  }),
                )}
              />
              <Txt kind="figure" color="ink2">
                {format.kg(dto.kilos.netGrams)}
              </Txt>
            </View>
          )}

          <StatusCapsule
            state={capsule}
            lang={lang}
            mm1={mm1}
            sentAt={sent}
            paidAt={paidAt}
            cashDay={dto.cashDay}
          />
          {capsule === "unclaimed" || capsule === "needs-action" || capsule === "paypal-held" ? (
            <Txt kind="statementBody">
              {tr(
                capsule === "unclaimed"
                  ? "M-MB-01.unclaimedDetail"
                  : capsule === "needs-action"
                    ? "M-MB-01.needsActionDetail"
                    : "M-MB-01.paypalHeldDetail",
                { name: dto.treasurer.first },
              )}
            </Txt>
          ) : null}

          <View ref={paminawaRef} collapsable={false}>
            <Slab
              testID="M-MB-01.paminawa"
              label={tr("M-MB-01.paminawa")}
              icon="listen"
              depth="d1"
              tone="chalk"
              height={target.hero}
              srLabel={tr("M-MB-01.paminawaHint")}
              onCommit={() => router.push("/(member)/paminawa")}
            />
            <Animated.View
              pointerEvents="none"
              style={[styles.invite, { borderColor: t.color.ink }, invite]}
            />
          </View>

          <View testID="moment-MM-7" dataSet={{ moment: "MM-7", momentPhase: mm7 }} collapsable={false}>
            <View collapsable={false} testID={`moment-MM-7-phase-${mm7}`} style={styles.marker} />
            <ReceiptBar
              dto={dto}
              expanded={expanded}
              onSegment={onSegment}
              onSlip={(serial, at) => setZoom({ serial, ...at })}
            />
          </View>

          <View>
            <SectionTitle>{tr("M-MB-01.slips")}</SectionTitle>
            <SlipChips
              slips={dto.slips}
              testPrefix="M-MB-01.chip"
              onOpen={(serial, at) => setZoom({ serial, ...at })}
            />
          </View>

          {dto.history.length ? (
            <View testID="M-MB-01.history">
              <SectionTitle>{tr("M-MB-01.history")}</SectionTitle>
              <View style={{ gap: space.s8 }}>
                {dto.history.map((h) => (
                  <View key={`${h.kind}-${h.at}`} style={styles.historyRow}>
                    {h.kind === "approved" && h.by ? (
                      <View style={styles.stamps}>
                        {h.by.map((i) => (
                          <InkStamp key={i} initials={i} />
                        ))}
                      </View>
                    ) : (
                      <View
                        style={[
                          styles.dot,
                          { backgroundColor: h.kind === "paid" ? t.color.jade : t.color.pencil },
                        ]}
                      />
                    )}
                    <Txt kind="body" style={{ flex: 1 }}>
                      {h.kind === "approved"
                        ? tr("M-MB-01.historyApproved", { a: h.by?.[0] ?? "", b: h.by?.[1] ?? "" })
                        : h.kind === "sent"
                          ? tr("M-MB-01.historySent")
                          : tr("M-MB-01.historyPaid")}
                    </Txt>
                    <Txt kind="figureS" color="ink2">
                      {`${format.dayMonth(h.at, lang)} ${format.time(h.at)}`}
                    </Txt>
                  </View>
                ))}
                {paidAt && !dto.history.some((h) => h.kind === "paid") ? (
                  <View style={styles.historyRow}>
                    <View style={[styles.dot, { backgroundColor: t.color.jade }]} />
                    <Txt kind="body" style={{ flex: 1 }}>
                      {tr("M-MB-01.historyPaid")}
                    </Txt>
                    <Txt kind="figureS" color="ink2">
                      {`${format.dayMonth(paidAt, lang)} ${format.time(paidAt)}`}
                    </Txt>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          <Rule />
          <View style={styles.footer}>
            {dto.batchSha256 ? (
              <SealView batchSha256={dto.batchSha256} size={48} keys={2} engrave={false} />
            ) : null}
            <Txt kind="caption" color="ink2" style={{ flex: 1 }}>
              {tr("M-MB-01.rateCard", { hash: format.hash(dto.rateCard.sha256, 2) })}
            </Txt>
          </View>
          <Sentence segments={ask} lang={lang} />
          <Button
            variant="text"
            label={tr("M-MB-01.recheck")}
            onPress={() => router.push("/(member)/(tabs)/pangutana")}
            style={{ alignSelf: "flex-start" }}
            testID="M-MB-01.recheck"
          />
          <Txt kind="caption" color="ink3">
            {tr("M-MB-01.estimateNote", { rate: dto.fx.phpPerUsd })}
          </Txt>
        </View>

        <View style={{ gap: space.s4 }}>
          <MachineTranslatedNote />
          <Txt kind="caption" color="ink3">
            {tr("common.syntheticData")}
          </Txt>
        </View>

        {demo && !linkToken ? (
          <View style={[styles.demo, { borderColor: t.color.rule }]} testID="M-MB-01.demo">
            <Txt kind="label" color="ink2">
              {tr("M-MB-01.demoTitle")}
            </Txt>
            <View style={styles.chips}>
              <Button
                variant="tonal"
                label={tr("M-MB-01.demoSend")}
                onPress={() => demo.advance("sent")}
                testID="demo.send"
              />
              <Button
                variant="tonal"
                label={tr("M-MB-01.demoConfirm")}
                onPress={() => demo.advance("paid")}
                testID="demo.paid"
              />
              <Button
                variant="tonal"
                label={tr("M-MB-01.demoUnclaimed")}
                onPress={() => demo.advance("unclaimed")}
                testID="demo.unclaimed"
              />
              <Button
                variant="text"
                label={tr("M-MB-01.demoReset")}
                onPress={() => demo.advance("checking")}
                testID="demo.reset"
              />
            </View>
          </View>
        ) : null}
      </Screen>
      {zoom ? (
        <SlipZoom
          slips={dto.slips}
          serial={zoom.serial}
          origin={{ x: zoom.x, y: zoom.y }}
          lang={lang}
          onPhase={setMm7}
          onClosed={() => {
            setZoom(null);
            setMm7(expanded ? "expanded" : "rest");
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  langRow: { flexDirection: "row", flexWrap: "wrap", gap: space.s8 },
  card: { padding: space.s16, gap: space.s24, borderRadius: radius.none },
  marker: { position: "absolute", width: 1, height: 1, opacity: 0 },
  invite: { position: "absolute", top: -4, left: -4, right: -4, bottom: -4, borderWidth: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.s8 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: space.s12, minHeight: 32 },
  stamps: { flexDirection: "row", gap: space.s4, width: 40 },
  dot: { width: 10, height: 10, marginHorizontal: 15 },
  footer: { flexDirection: "row", alignItems: "center", gap: space.s12 },
  demo: {
    gap: space.s8,
    padding: space.s12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radius.plate,
  },
});
