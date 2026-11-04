/**
 * M-BD-02 Sign (S1.9, design D2, S2.9 MM-5): the seal his phone drew from the batch, the hash to compare with the
 * console, the amount, and in the thumb zone the d3 jade slab "Pirmahi", 64 dp: hold 1,200 ms (a tick each
 * quarter), release inside, then the fingerprint or device PIN, then an Ed25519 signature over the JCS payload with
 * `fs-ernesto-a1`. A judge's browser signs with a labelled demo key. "Can't hold?" and TalkBack take the dialog.
 * When the key is in, rings 3–4 engrave, the seal lands, and the amount turns from pencil to ink.
 */
import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { format } from "../../_shims/domain";
import { people } from "../../_shims/seed";
import { space, target } from "../../_shims/tokens.native";
import { railLabel } from "../../lib/payout-status";
import { deviceKeyId } from "../../lib/signing";
import { pirmaHref } from "../../services/session";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Screen } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { MomentMarker } from "../../ui/moment";
import { HOLD_MS } from "../../ui/motion";
import { Banner, Button, InkStamp } from "../../ui/primitives";
import { SealView } from "../../ui/seal-view";
import { Slab } from "../../ui/slab";
import { Skeleton } from "../../ui/states";
import { Txt } from "../../ui/text";
import { memberOf, presenceView } from "./cosign-model";
import type { BoardKey } from "./messages";
import { Gloss, SignedAmount, useCompact, useGloss } from "./parts";
import { amountStateFor, SIGN_SCREEN_STATE, type SignPhase, sealKeys, slabLive } from "./sign-flow";
import { useSign } from "./use-sign";
import { useT } from "./use-t";

/** Why the slab cannot be held right now: shown under the flush, hatched slab (never greyed out, S2.7). */
const BLOCKED: Partial<Record<SignPhase, BoardKey>> = {
  waiting: "M-BD-02.waitKey1",
  offline: "M-BD-01.offline",
  mismatch: "M-BD-02.mismatch",
  expired: "M-BD-01.expired",
  "no-lock": "M-BD-02.noLock",
  invalidated: "M-BD-02.invalidated",
  closed: "M-BD-02.closed",
  declined: "M-BD-01.sentBack",
  loading: "common.loading",
};

/** A failed attempt that leaves the slab live: said once, above it. */
const NOTE: Partial<Record<SignPhase | "stale", BoardKey>> = {
  cancelled: "M-BD-02.cancelled",
  error: "M-BD-02.error",
  "locked-out": "M-BD-02.lockedOut",
  stale: "M-BD-02.stale",
};

export function SignScreen() {
  const {
    c,
    phase,
    flow,
    mm5,
    attempt,
    key,
    upcoming,
    presence,
    nativeUnsupported,
    onHoldState,
    commit,
    retry,
    newKey,
  } = useSign();
  const { api, session, lang } = useApp();
  const { t } = useFs();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const compact = useCompact();
  const gloss = useGloss();
  const dto = c.dto;
  const treasurer = people.treasurer.first;

  useFocusEffect(
    useCallback(() => {
      if (c.status !== "request" && c.status !== "override") return;
      void api.postPresence({ view: `${presenceView(c.runSlug, null)}:sign` });
    }, [api, c.runSlug, c.status]),
  );

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace(pirmaHref(c.runSlug));
  };

  const ownHash = c.check?.recomputed?.batchSha256 ?? null;
  const done = phase === "signed" || phase === "sealed" || phase === "inked";
  const keys = sealKeys(phase, c.key1);
  // The amount, the seal and the slab share one screen: the seal gives way on short phones (never below 132 dp).
  const sealSize = Math.max(
    132,
    Math.min(232, width - 4 * space.s16, compact ? Number.POSITIVE_INFINITY : height - RESERVED_DP),
  );
  const demoKey = (key?.biometricClass ?? presence) === "none";
  const amount = dto ? format.usd(dto.totalCents) : "";

  const header = (
    <View style={styles.header}>
      <Pressable
        onPress={back}
        accessibilityRole="button"
        accessibilityLabel={tr("M-BD-02.back")}
        hitSlop={8}
        style={({ pressed }) => [styles.backButton, pressed && { backgroundColor: t.color.pencilWash }]}
        testID="M-BD-02.back"
      >
        <Glyph name="back" color={t.color.ink} />
      </Pressable>
      <View style={styles.flex}>
        <Txt kind="title2" accessibilityRole="header">
          {tr("M-BD-02.title")}
        </Txt>
        <Gloss text={gloss("M-BD-02.title")} />
      </View>
    </View>
  );

  if (!dto || !ownHash) {
    const reason = nativeUnsupported ? "M-BD-02.nativeEnrollment" : BLOCKED[phase];
    return (
      <Screen testID="M-BD-02" state={SIGN_SCREEN_STATE[phase]}>
        {header}
        {phase === "loading" ? (
          <Skeleton lines={2} block={sealSize} />
        ) : (
          <Banner tone="decide" icon="info" testID={`M-BD-02.${phase}`}>
            <Txt kind="body">{tr(reason ?? "M-BD-02.closed", { name: treasurer })}</Txt>
          </Banner>
        )}
      </Screen>
    );
  }

  const blocked = nativeUnsupported
    ? "M-BD-02.nativeEnrollment"
    : slabLive(phase) || phase === "biometric"
      ? undefined
      : BLOCKED[phase];
  const note = flow === "stale" ? NOTE.stale : NOTE[phase];
  const captionKey: BoardKey =
    phase === "biometric"
      ? demoKey
        ? "M-BD-02.signingDemo"
        : "M-BD-02.signing"
      : demoKey
        ? "M-BD-02.caption.demo"
        : presence === "biometric-bound"
          ? "M-BD-02.caption.biometric"
          : "M-BD-02.caption.pin";
  const caption = tr(captionKey);
  const persona = session?.persona ?? "board:ernesto";
  // The key the next signature makes: `fs-ernesto-a1` on a new phone, `-a2` once a new key replaced it.
  const nextKeyId = upcoming ?? deviceKeyId(persona);
  const keyLine = demoKey
    ? key
      ? tr("M-BD-02.key.demo", { key: key.keyId })
      : tr("M-BD-02.key.demoNew")
    : key
      ? tr("M-BD-02.key.device", { key: key.keyId })
      : tr("M-BD-02.key.first", { key: nextKeyId });

  const thumb = (
    <View
      style={[
        styles.thumb,
        {
          paddingBottom: compact ? 0 : insets.bottom + space.s16,
          backgroundColor: t.color.ground,
          borderTopColor: t.color.rule,
        },
        compact ? styles.thumbInline : null,
      ]}
    >
      {done ? (
        <View style={styles.doneZone} testID="M-BD-02.signed" accessibilityLiveRegion="polite">
          <Txt kind="bodyStrong">{tr("M-BD-02.signed", { key: key?.keyId ?? nextKeyId })}</Txt>
          <Gloss text={gloss("M-BD-02.signed", { key: key?.keyId ?? nextKeyId })} />
          {demoKey ? (
            <Txt kind="caption" color="ink2" testID="M-BD-02.demo-key">
              {tr("common.demoKey")}
            </Txt>
          ) : null}
          <Button tall label={tr("M-BD-02.done")} onPress={back} testID="M-BD-02.done" />
        </View>
      ) : (
        <>
          {note ? (
            <Banner
              tone={phase === "cancelled" || flow === "stale" ? "neutral" : "decide"}
              icon="info"
              testID={`M-BD-02.note`}
            >
              <Txt kind="body">{tr(note)}</Txt>
              <Gloss text={gloss(note)} />
            </Banner>
          ) : null}
          {!blocked ? (
            <Txt
              kind="body"
              color="ink2"
              align="center"
              testID="M-BD-02.caption"
              accessibilityLiveRegion={phase === "biometric" ? "polite" : "none"}
            >
              {caption}
            </Txt>
          ) : null}
          {!blocked ? <Gloss text={gloss(captionKey)} align="center" /> : null}
          <Slab
            // A slab that goes flush (the batch changed, the request closed) is a new slab: the shared Slab would
            // otherwise keep its dialog open and act on an armed release (I4; the shell is asked to stop that too).
            key={`${attempt}${blocked ? ".flush" : ""}`}
            testID="M-BD-02.slab"
            label={tr("M-BD-02.slab")}
            icon="fingerprint"
            depth="d3"
            tone="jade"
            hold={HOLD_MS.phone}
            height={target.hero}
            unavailableReason={
              blocked
                ? [tr(blocked, { name: treasurer }), gloss(blocked, { name: treasurer })]
                    .filter(Boolean)
                    .join("\n")
                : undefined
            }
            srLabel={tr("M-BD-02.srLabel", {
              label: tr("M-BD-02.slab"),
              amount: format.amountSpoken(dto.totalCents),
            })}
            onHoldState={onHoldState}
            onCommit={commit}
            anotherWayLabel={tr("M-BD-02.another")}
            confirm={{
              title: tr("M-BD-02.confirmTitle"),
              body: tr(demoKey ? "M-BD-02.confirmBodyDemo" : "M-BD-02.confirmBody", {
                n: dto.itemCount,
                amount,
              }),
              amount,
              recipients: dto.items.map((i) => ({ name: memberOf(i), amount: format.usd(i.amountCents) })),
              batchSha256: ownHash,
              keys: c.key1 ? 1 : 0,
              confirmLabel: tr("M-BD-02.confirmSign"),
              cancelLabel: tr("common.cancel"),
            }}
          />
          {phase === "mismatch" ? (
            <Button
              variant="tonal"
              icon="refresh"
              label={tr("M-BD-01.reviewAgain")}
              onPress={() => {
                void c.reload(true);
                retry();
                back();
              }}
              testID="M-BD-02.review-again"
            />
          ) : phase === "invalidated" ? (
            <Button
              variant="tonal"
              label={tr("M-BD-02.newKey")}
              onPress={() => void newKey()}
              testID="M-BD-02.new-key"
            />
          ) : phase === "no-lock" ? (
            <Button
              variant="tonal"
              icon="refresh"
              label={tr("common.tryAgain")}
              onPress={retry}
              testID="M-BD-02.retry"
            />
          ) : null}
          <Txt kind="caption" color="ink3" align="center" testID="M-BD-02.key" selectable>
            {keyLine}
          </Txt>
        </>
      )}
    </View>
  );

  return (
    <Screen
      testID="M-BD-02"
      state={SIGN_SCREEN_STATE[phase]}
      footer={compact ? undefined : thumb}
      contentStyle={[styles.content, compact ? { paddingBottom: insets.bottom + space.s24 } : null]}
    >
      {dto.rail === "simulated" ? (
        <Txt kind="caption" testID="M-BD-02.rail">
          {railLabel(dto.rail, "simulated_rail", lang).chip}
        </Txt>
      ) : null}
      <View {...mm5.rootProps} style={styles.moment} collapsable={false}>
        <MomentMarker id="MM-5" phase={mm5.phase} />
        {header}
        <View style={[styles.plate, { backgroundColor: t.color.plate }]} testID="M-BD-02.batch">
          <SealView
            batchSha256={ownHash}
            size={sealSize}
            keys={keys}
            engrave={c.engrave}
            testID="M-BD-02.seal"
          />
          <View style={styles.hash}>
            <Txt
              kind="hash"
              color="ink2"
              align="center"
              testID="M-BD-02.hash"
              dataSet={{ hash: ownHash }}
              accessibilityLabel={tr("seal.hash", { hash: format.hash(ownHash) })}
            >
              {`${format.hash(ownHash, 2)} … ${format.hash(ownHash.slice(-8))}`}
            </Txt>
            <Txt kind="caption" color="ink3" align="center">
              {tr("M-BD-02.compare")}
            </Txt>
          </View>
          <View style={styles.amount}>
            <SignedAmount
              text={amount}
              srLabel={format.amountSpoken(dto.totalCents)}
              ink={amountStateFor(phase) === "ink"}
              live={c.engrave}
              testID="M-BD-02.amount"
              align="center"
            />
            <Txt kind="body" color="ink2" align="center">
              {tr("M-BD-01.count", { n: dto.itemCount })}
            </Txt>
          </View>
        </View>
        {phase === "sealed" || phase === "inked" ? (
          <View style={styles.approved} testID="M-BD-02.sealed">
            <InkStamp initials={people.treasurer.initials} label={people.treasurer.name} />
            <InkStamp initials={people.chair.initials} label={people.chair.name} />
            <View style={styles.flex}>
              <Txt kind="bodyStrong">{tr("M-BD-02.sealed", { a: treasurer, b: people.chair.first })}</Txt>
              <Gloss text={gloss("M-BD-02.sealed", { a: treasurer, b: people.chair.first })} />
            </View>
          </View>
        ) : null}
        {phase === "inked" ? (
          <View>
            <Txt kind="body" color="ink2">
              {tr("M-BD-02.next", { n: dto.itemCount })}
            </Txt>
            <Gloss text={gloss("M-BD-02.next", { n: dto.itemCount })} />
          </View>
        ) : null}
        {compact ? thumb : null}
      </View>
    </Screen>
  );
}

/** Everything on the sign sheet except the seal, in dp (header, amount, hash, thumb zone, insets). */
const RESERVED_DP = 620;

const styles = StyleSheet.create({
  content: { maxWidth: 560, width: "100%", alignSelf: "center", paddingBottom: space.s24 },
  moment: { gap: space.s24 },
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: space.s8, marginLeft: -space.s12 },
  backButton: {
    width: target.min,
    height: target.min,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: target.min / 2,
  },
  plate: { alignItems: "center", gap: space.s12, paddingVertical: space.s24, paddingHorizontal: space.s16 },
  hash: { gap: space.s2, alignItems: "center" },
  amount: { gap: space.s4, alignItems: "center", alignSelf: "stretch" },
  approved: { flexDirection: "row", alignItems: "center", gap: space.s8 },
  thumb: {
    gap: space.s8,
    paddingHorizontal: space.s16,
    paddingTop: space.s16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  thumbInline: { paddingHorizontal: 0, paddingTop: space.s16 },
  doneZone: { gap: space.s8 },
});
