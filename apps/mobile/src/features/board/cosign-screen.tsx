/**
 * M-BD-01 co-sign request (S1.9, design D1): what Ernesto signs and why, in ten seconds, in one scroll:
 * the amount; why him; the three resolved holds with who resolved them; the seal his phone draws from the hash it
 * computed itself, with the hash in groups of four to compare with the console; key 1 and the treasurer's presence;
 * the payouts; and the flat "Ipabalik kang Analyn", which needs a reason. The thumb zone holds the way to the sign
 * sheet (M-BD-02). Nothing here signs, and nothing is ever queued: offline, it says so and waits.
 */
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, TextInput, useWindowDimensions, View, type ViewInstance } from "react-native";
import { format } from "../../_shims/domain";
import { people } from "../../_shims/seed";
import { radius, space, target } from "../../_shims/tokens.native";
import { signHref } from "../../services/session";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { focusFirst } from "../../ui/a11y";
import { Screen } from "../../ui/chrome";
import { LanguagePicker } from "../../ui/language-picker";
import { Sheet } from "../../ui/overlay";
import { Banner, Button, InkStamp, SectionTitle } from "../../ui/primitives";
import { SealView } from "../../ui/seal-view";
import { figures, Sentence } from "../../ui/sentence";
import { EmptyState, Skeleton } from "../../ui/states";
import { Txt } from "../../ui/text";
import { useCosign } from "./cosign-context";
import { presenceView, whyKey } from "./cosign-model";
import {
  Gloss,
  HashRows,
  HoldRow,
  PayoutRows,
  PresenceLine,
  PushNote,
  SignedAmount,
  SimulatedPush,
  useCompact,
  useGloss,
} from "./parts";
import { useT } from "./use-t";

const PRESENCE_EVERY_MS = 10_000;

export function CosignScreen() {
  const c = useCosign();
  const { api, lang } = useApp();
  const { t } = useFs();
  const tr = useT();
  const { width } = useWindowDimensions();
  const compact = useCompact();
  const gloss = useGloss();
  const [openHold, setOpenHold] = useState<string | null>(null);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const top = useRef<ViewInstance>(null);
  const treasurer = people.treasurer.first;
  const dto = c.dto;
  const signable = c.status === "request" || c.status === "override";

  // "Opening a hold emits presence" (S1.9): the console shows "Ernesto, reviewing hold 2 on his phone".
  const view = presenceView(c.runSlug, openHold);
  useFocusEffect(
    useCallback(() => {
      if (!signable) return;
      const post = () => void api.postPresence({ view });
      post();
      const id = setInterval(post, PRESENCE_EVERY_MS);
      return () => clearInterval(id);
    }, [api, view, signable]),
  );

  // The amount takes first focus once the request is on screen (S1.12: the screen reader lands on what he signs).
  const hasDto = !!dto;
  useEffect(() => (hasDto ? focusFirst(top) : undefined), [hasDto]);

  if (!dto) {
    return (
      <Screen testID="M-BD-01" state={c.status}>
        {c.status === "loading" ? (
          <View style={styles.loading}>
            <Skeleton lines={1} block={52} />
            <Skeleton lines={3} />
            <Skeleton lines={0} block={200} />
          </View>
        ) : c.status === "none" ? (
          <EmptyState
            glyph="sign"
            title={tr("M-BD-01.none")}
            body={tr("M-BD-01.noneBody")}
            testID="M-BD-01.none"
            action={
              <Button
                variant="tonal"
                icon="refresh"
                label={tr("common.tryAgain")}
                onPress={() => void c.reload()}
                testID="M-BD-01.retry"
              />
            }
          />
        ) : (
          <Banner
            tone={c.status === "offline" ? "neutral" : "decide"}
            icon={c.status === "offline" ? "wifiOff" : "info"}
            testID={`M-BD-01.${c.status}`}
            action={
              <Button
                variant="text"
                label={tr("common.tryAgain")}
                onPress={() => void c.reload()}
                testID="M-BD-01.retry"
              />
            }
          >
            <Txt kind="bodyStrong">{tr(c.status === "offline" ? "common.offline" : "M-BD-01.error")}</Txt>
            <Txt kind="body" color="ink2">
              {tr(c.status === "offline" ? "M-BD-01.offline" : "common.error")}
            </Txt>
          </Banner>
        )}
        <PushNote />
      </Screen>
    );
  }

  const amount = format.usd(dto.totalCents);
  const threshold = format.usd(dto.thresholdCents).replace(/\.00$/, "");
  const recomputed = c.check?.ok ? c.check.recomputed : (c.check?.recomputed ?? null);
  // The seal and the hash are always the phone's own; the server's claim is only ever shown beside them.
  const ownHash = recomputed?.batchSha256 ?? null;
  const signed = c.status === "signed";
  const sealSize = Math.min(208, width - 2 * space.s16 - 2 * space.s24);
  const showPush = Platform.OS === "web" && signable;

  const action = signable ? (
    <Button
      tall
      icon="sign"
      label={tr("M-BD-01.sign")}
      onPress={() => router.push(signHref(c.runSlug))}
      testID="M-BD-01.sign"
    />
  ) : c.status === "changed" && c.change !== "hash" ? (
    <Button
      tall
      variant="tonal"
      icon="refresh"
      label={tr("M-BD-01.reviewAgain")}
      onPress={() => void c.reload(true)}
      testID="M-BD-01.review-again"
    />
  ) : c.status === "offline" ? (
    <Button tall icon="sign" label={tr("M-BD-01.sign")} disabled testID="M-BD-01.sign" />
  ) : null;
  // The thumb zone holds the one way forward; with large text it joins the scroll instead (S1.12 reflow).
  const footer =
    action && !compact ? (
      <View style={[styles.footer, { backgroundColor: t.color.ground, borderTopColor: t.color.rule }]}>
        {action}
      </View>
    ) : null;

  return (
    <Screen testID="M-BD-01" state={c.status} footer={footer} contentStyle={styles.content}>
      {showPush ? <SimulatedPush dto={dto} /> : null}
      <StatusBanner />

      <View ref={top} style={styles.lead} accessible={false}>
        <Txt kind="title2" accessibilityRole="header">
          {tr("M-BD-01.heading", { season: dto.seasonCode })}
        </Txt>
        <Gloss text={gloss("M-BD-01.heading", { season: dto.seasonCode })} />
        <SignedAmount
          text={amount}
          srLabel={format.amountSpoken(dto.totalCents)}
          ink={signed}
          live={c.engrave}
          testID="M-BD-01.amount"
        />
        <Txt kind="body" color="ink2">
          {tr("M-BD-01.count", { n: dto.itemCount })}
        </Txt>
        <Gloss text={gloss("M-BD-01.count", { n: dto.itemCount })} />
        <Sentence segments={figures(tr(whyKey(dto), { threshold }))} testID="M-BD-01.why" />
        <Gloss text={gloss(whyKey(dto), { threshold })} testID="M-BD-01.why.gloss" />
      </View>

      {dto.holds.length > 0 ? (
        <View style={styles.section} testID="M-BD-01.holds">
          <SectionTitle>{tr("M-BD-01.holds", { n: dto.holds.length })}</SectionTitle>
          {dto.holds.map((h) => (
            <HoldRow
              key={h.id}
              hold={h}
              expanded={openHold === h.id}
              onToggle={() => setOpenHold((o) => (o === h.id ? null : h.id))}
            />
          ))}
        </View>
      ) : null}

      <View style={[styles.plate, { backgroundColor: t.color.plate }]} testID="M-BD-01.seal-plate">
        {ownHash ? (
          <>
            <SealView
              batchSha256={ownHash}
              size={sealSize}
              keys={c.keys}
              engrave={c.engrave}
              testID="M-BD-01.seal"
            />
            <HashRows hex={ownHash} testID="M-BD-01.hash" />
            <Txt kind="label" color="ink2" align="center">
              {tr("M-BD-01.seal")}
            </Txt>
            <Txt kind="caption" color="ink2" align="center" testID="M-BD-01.computed">
              {tr("M-BD-01.computed", { n: recomputed?.itemCount ?? dto.items.length })}
            </Txt>
            <Gloss
              text={gloss("M-BD-01.computed", { n: recomputed?.itemCount ?? dto.items.length })}
              align="center"
            />
          </>
        ) : (
          <Txt kind="body" color="ink2">
            {tr("M-BD-01.hashMismatch", { name: treasurer })}
          </Txt>
        )}
      </View>

      <View style={styles.section} testID="M-BD-01.keys">
        <View style={styles.keyLine} testID="M-BD-01.key1">
          {c.key1 ? <InkStamp initials={people.treasurer.initials} label={people.treasurer.name} /> : null}
          <View style={styles.flexShrink}>
            <Txt kind="body">
              {c.key1
                ? tr("M-BD-01.key1", { name: treasurer })
                : tr("M-BD-01.waitingKey1", { name: treasurer })}
            </Txt>
            <Gloss text={gloss(c.key1 ? "M-BD-01.key1" : "M-BD-01.waitingKey1", { name: treasurer })} />
          </View>
        </View>
        {signed ? (
          <View style={styles.keyLine} testID="M-BD-01.key2">
            <InkStamp initials={people.chair.initials} label={people.chair.name} />
            <Txt kind="bodyStrong" style={styles.flexShrink}>
              {tr("M-BD-01.approvedBy", { a: treasurer, b: people.chair.first })}
            </Txt>
          </View>
        ) : c.presence && signable ? (
          <PresenceLine name={treasurer} />
        ) : null}
      </View>

      {compact ? action : null}

      <View style={styles.section}>
        <SectionTitle>{tr("M-BD-01.items")}</SectionTitle>
        <PayoutRows items={dto.items} totalCents={dto.totalCents} state={signed ? "ink" : "pencil"} />
      </View>

      {signable ? (
        <Button
          variant="text"
          label={
            c.status === "override" ? tr("M-BD-01.overrideNo") : tr("M-BD-01.sendBack", { name: treasurer })
          }
          onPress={() => setSendBackOpen(true)}
          style={styles.flat}
          testID="M-BD-01.send-back"
        />
      ) : null}

      <View style={styles.meta}>
        <Txt kind="caption" color="ink3" selectable>
          {tr("M-BD-01.batch", { batch: dto.senderBatchId })}
        </Txt>
        {signable ? (
          <Txt kind="caption" color="ink3" testID="M-BD-01.expires">
            {tr("M-BD-01.expires", {
              time: `${format.dayMonth(dto.expiresAt, lang)} ${format.time(dto.expiresAt)}`,
            })}
          </Txt>
        ) : null}
      </View>

      <PushNote />

      <View style={styles.section}>
        <SectionTitle>{tr("M-BD-01.language")}</SectionTitle>
        <LanguagePicker testID="M-BD-01.lang" />
      </View>

      <SendBackSheet visible={sendBackOpen} onClose={() => setSendBackOpen(false)} />
    </Screen>
  );
}

/** The state of the request in one banner: changed, expired, offline, sent back, or signed. */
function StatusBanner() {
  const c = useCosign();
  const tr = useT();
  const gloss = useGloss();
  const treasurer = people.treasurer.first;
  switch (c.status) {
    case "changed":
      return (
        <Banner tone="decide" icon="info" testID="M-BD-01.changed">
          <Txt kind="bodyStrong">
            {c.change === "hash" ? tr("M-BD-01.hashMismatch", { name: treasurer }) : tr("M-BD-01.changed")}
          </Txt>
          <Gloss
            text={
              c.change === "hash"
                ? gloss("M-BD-01.hashMismatch", { name: treasurer })
                : gloss("M-BD-01.changed")
            }
          />
          {c.change === "hash" && c.dto && c.check && !c.check.ok && c.check.recomputed ? (
            <>
              <Txt kind="hash" color="ink2">
                {tr("M-BD-01.claimed", { hash: format.hash(c.dto.batchSha256, 4) })}
              </Txt>
              <Txt kind="hash" color="ink2">
                {tr("M-BD-01.ours", { hash: format.hash(c.check.recomputed.batchSha256, 4) })}
              </Txt>
            </>
          ) : null}
        </Banner>
      );
    case "expired":
      return (
        <Banner tone="decide" icon="clock" testID="M-BD-01.expired">
          <Txt kind="body">{tr("M-BD-01.expired", { name: treasurer })}</Txt>
          <Gloss text={gloss("M-BD-01.expired", { name: treasurer })} />
        </Banner>
      );
    case "offline":
      return (
        <Banner icon="wifiOff" testID="M-BD-01.offline">
          <Txt kind="bodyStrong">{tr("common.offline")}</Txt>
          <Txt kind="body" color="ink2">
            {tr("M-BD-01.offline")}
          </Txt>
          <Gloss text={gloss("M-BD-01.offline")} />
        </Banner>
      );
    case "sent-back":
      return (
        <Banner icon="back" testID="M-BD-01.sent-back">
          <Txt kind="body">{tr("M-BD-01.sentBack", { name: treasurer })}</Txt>
          <Gloss text={gloss("M-BD-01.sentBack", { name: treasurer })} />
        </Banner>
      );
    case "signed":
      return (
        <Banner icon="check" testID="M-BD-01.signed">
          <Txt kind="bodyStrong">{tr("M-BD-01.signed")}</Txt>
          <Gloss text={gloss("M-BD-01.signed")} />
        </Banner>
      );
    case "override":
      return (
        <Banner tone="decide" icon="info" testID="M-BD-01.override">
          <Txt kind="body">{tr("M-BD-01.override", { name: treasurer })}</Txt>
          <Gloss text={gloss("M-BD-01.override", { name: treasurer })} />
        </Banner>
      );
    default:
      return null;
  }
}

/** "Ipabalik kang Analyn": a sheet that needs a reason; nothing is signed either way. */
function SendBackSheet({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const c = useCosign();
  const { t } = useFs();
  const tr = useT();
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "failed">("idle");
  const treasurer = people.treasurer.first;
  const ready = reason.trim().length >= 3;
  const send = async () => {
    if (!ready || state === "sending") return;
    setState("sending");
    const ok = await c.sendBack(reason.trim());
    if (ok) {
      setReason("");
      setState("idle");
      onClose();
    } else {
      setState("failed");
    }
  };
  return (
    <Sheet
      visible={visible}
      title={tr("M-BD-01.sendBack.title", { name: treasurer })}
      onClose={onClose}
      testID="M-BD-01.send-back.sheet"
    >
      <Txt kind="body" color="ink2">
        {tr("M-BD-01.sendBack.body", { name: treasurer })}
      </Txt>
      <View style={styles.reasonBlock}>
        <Txt kind="label" color="ink2" nativeID="M-BD-01-reason-label">
          {tr("M-BD-01.sendBack.reason", { name: treasurer })}
        </Txt>
        <TextInput
          testID="M-BD-01.send-back.reason"
          accessibilityLabel={tr("M-BD-01.sendBack.reason", { name: treasurer })}
          accessibilityLabelledBy="M-BD-01-reason-label"
          value={reason}
          onChangeText={setReason}
          multiline
          maxLength={280}
          textAlignVertical="top"
          style={[
            styles.reason,
            {
              color: t.color.ink,
              borderColor: reason.length > 0 ? t.color.ink2 : t.color.rule,
              backgroundColor: t.color.plate,
            },
          ]}
        />
        {!ready && reason.length > 0 ? (
          <Txt kind="caption" color="ink2">
            {tr("M-BD-01.sendBack.short")}
          </Txt>
        ) : null}
        {state === "failed" ? (
          <Txt kind="caption" color="ink2" accessibilityLiveRegion="polite" testID="M-BD-01.send-back.failed">
            {tr("M-BD-01.sendBack.failed")}
          </Txt>
        ) : null}
      </View>
      <View style={styles.sheetActions}>
        <Button
          variant="text"
          label={tr("common.cancel")}
          onPress={onClose}
          testID="M-BD-01.send-back.cancel"
        />
        <Button
          label={tr("M-BD-01.sendBack.confirm")}
          disabled={!ready || state === "sending"}
          onPress={() => void send()}
          testID="M-BD-01.send-back.confirm"
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { maxWidth: 560, width: "100%", alignSelf: "center" },
  loading: { gap: space.s24 },
  lead: { gap: space.s8 },
  section: { gap: space.s4 },
  plate: {
    alignItems: "center",
    gap: space.s12,
    paddingVertical: space.s24,
    paddingHorizontal: space.s16,
    borderRadius: radius.none,
  },
  keyLine: { flexDirection: "row", alignItems: "center", gap: space.s8, minHeight: 28 },
  flat: { alignSelf: "flex-start" },
  flexShrink: { flexShrink: 1 },
  meta: { gap: space.s2 },
  footer: {
    paddingHorizontal: space.s16,
    paddingVertical: space.s12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  reasonBlock: { gap: space.s8 },
  reason: {
    minHeight: 96,
    borderWidth: 1.5,
    borderRadius: radius.plate,
    padding: space.s12,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: "MonaSans_400Regular",
  },
  sheetActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: space.s8,
    minHeight: target.min,
  },
});
