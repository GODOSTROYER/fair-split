/**
 * M-BD-01 co-sign request (design D1): one scroll with the amount, why him, the three resolved holds with who
 * resolved them, the seal and the batch hash in groups of four to compare with the console, the treasurer's
 * presence, and a flat "Ipabalik kang Analyn" that needs a reason. A signature is never queued: offline, signing
 * waits for a connection.
 */
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { format } from "../../_shims/domain";
import { people } from "../../_shims/seed";
import { radius, space } from "../../_shims/tokens.native";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Screen } from "../../ui/chrome";
import { Banner, Button, InkStamp, Rule, SectionTitle } from "../../ui/primitives";
import { SealView } from "../../ui/seal-view";
import { figures, Sentence } from "../../ui/sentence";
import { Txt } from "../../ui/text";
import type { BoardKey } from "./messages";
import { useCosign } from "./use-cosign";
import { useT } from "./use-t";

/** Hash in groups of four, four groups a line, so the Chair can compare it with the console by eye. */
export function HashBlock({ hex }: { hex: string }) {
  const groups = format.hash(hex).split(" ");
  const lines: string[] = [];
  for (let i = 0; i < groups.length; i += 4) lines.push(groups.slice(i, i + 4).join(" "));
  return (
    <View accessible accessibilityLabel={`Batch hash ${format.hash(hex, 2)}`}>
      {lines.map((l) => (
        <Txt key={l} kind="hash" color="ink2">
          {l}
        </Txt>
      ))}
    </View>
  );
}

export function CosignScreen() {
  const { runSlug } = useLocalSearchParams<{ runSlug: string }>();
  const { api, lang } = useApp();
  const { t } = useFs();
  const tr = useT();
  const { dto, state, presence, treasurerSigned, reload } = useCosign(runSlug ?? "");
  const [sendBack, setSendBack] = useState<"closed" | "open" | "sending" | "sent">("closed");
  const [reason, setReason] = useState("");
  const treasurer = people.treasurer.first;

  if (!dto) {
    return (
      <Screen testID="M-BD-01" state={state}>
        {state === "none" ? (
          <Banner icon="info">
            <Txt kind="body">{tr("M-BD-01.empty")}</Txt>
          </Banner>
        ) : state === "offline" ? (
          <Banner
            tone="decide"
            icon="wifiOff"
            action={<Button variant="text" label={tr("common.tryAgain")} onPress={() => void reload()} />}
          >
            <Txt kind="body">{tr("M-BD-01.offline")}</Txt>
          </Banner>
        ) : null}
      </Screen>
    );
  }

  const keys: 0 | 1 | 2 = state === "signed" ? 2 : treasurerSigned ? 1 : 0;
  const threshold = format.usd(dto.thresholdCents).replace(/\.00$/, "");

  return (
    <Screen testID="M-BD-01" state={sendBack === "sent" ? "sent-back" : state}>
      <View style={{ gap: space.s4 }}>
        <Txt kind="title1" accessibilityRole="header">
          {tr("M-BD-01.title")}
        </Txt>
        <Txt kind="body" color="ink2">
          {tr("M-BD-01.request", { season: dto.seasonCode, n: dto.itemCount })}
        </Txt>
      </View>

      {state === "changed" ? (
        <Banner tone="decide" icon="info" testID="M-BD-01.changed">
          <Txt kind="body">{tr("M-BD-01.changed")}</Txt>
        </Banner>
      ) : null}
      {state === "expired" ? (
        <Banner tone="decide" icon="clock" testID="M-BD-01.expired">
          <Txt kind="body">{tr("M-BD-01.expired", { name: treasurer })}</Txt>
        </Banner>
      ) : null}
      {state === "offline" ? (
        <Banner tone="decide" icon="wifiOff" testID="M-BD-01.offline">
          <Txt kind="body">{tr("M-BD-01.offline")}</Txt>
        </Banner>
      ) : null}
      {sendBack === "sent" ? (
        <Banner icon="check" testID="M-BD-01.sent-back">
          <Txt kind="body">{tr("M-BD-01.sentBack", { name: treasurer })}</Txt>
        </Banner>
      ) : null}

      <View style={[styles.card, { backgroundColor: t.color.plate }]}>
        <Txt
          kind="amountHero"
          color={state === "signed" ? "ink" : "pencil"}
          accessibilityLabel={format.amountSpoken(dto.totalCents)}
        >
          {format.usd(dto.totalCents)}
        </Txt>
        <Sentence segments={figures(tr("M-BD-01.why", { threshold }))} />
        <Rule />
        <SectionTitle>{tr("M-BD-01.holds")}</SectionTitle>
        {dto.holds.map((h) => (
          <View key={h.id} style={styles.hold}>
            <InkStamp initials={h.resolvedBy} />
            <View style={{ flex: 1, gap: space.s2 }}>
              <Txt kind="bodyStrong">{`${h.id}, ${tr(`hold.${h.kind}` as BoardKey)}`}</Txt>
              <Txt kind="body" color="ink2">
                {h.summary}
              </Txt>
            </View>
            <Txt kind="figureS" color="ink3">
              {format.time(h.resolvedAt)}
            </Txt>
          </View>
        ))}
        <Rule />
        <SectionTitle>{tr("M-BD-01.items")}</SectionTitle>
        {dto.items.map((i) => (
          <View key={i.senderItemId} style={styles.item}>
            <Txt kind="figure" style={{ flex: 1 }}>
              {i.memberNo}
            </Txt>
            <Txt kind="figure">{format.usd(i.amountCents)}</Txt>
          </View>
        ))}
      </View>

      <View style={[styles.card, styles.sealCard, { backgroundColor: t.color.plate }]} testID="M-BD-01.seal">
        <SealView batchSha256={dto.batchSha256} size={200} keys={keys} />
        <Txt kind="label" color="ink2" align="center">
          {tr("M-BD-01.seal")}
        </Txt>
        <HashBlock hex={dto.batchSha256} />
      </View>

      <View style={{ gap: space.s8 }}>
        <View style={styles.key}>
          {treasurerSigned ? (
            <InkStamp initials={people.treasurer.initials} label={people.treasurer.name} />
          ) : null}
          <Txt kind="body">
            {treasurerSigned
              ? tr("M-BD-01.key1", { name: treasurer })
              : tr("M-BD-01.waitingKey1", { name: treasurer })}
          </Txt>
        </View>
        {presence?.startsWith("treasurer") ? (
          <Txt kind="body" color="ink2" accessibilityLiveRegion="polite" testID="M-BD-01.presence">
            {tr("M-BD-01.presence", { name: treasurer })}
          </Txt>
        ) : null}
      </View>

      {state === "request" ? (
        <Button
          tall
          icon="sign"
          label={tr("M-BD-01.review")}
          onPress={() => router.push(`/pirma/${dto.runSlug}/sign` as never)}
          testID="M-BD-01.review"
        />
      ) : null}
      {state === "signed" ? (
        <Banner icon="check">
          <Txt kind="body">{tr("M-BD-01.signedAlready")}</Txt>
        </Banner>
      ) : null}

      {state === "request" && sendBack !== "sent" ? (
        sendBack === "closed" ? (
          <Button
            variant="text"
            label={tr("M-BD-01.sendBack", { name: treasurer })}
            onPress={() => setSendBack("open")}
            style={{ alignSelf: "flex-start" }}
            testID="M-BD-01.send-back"
          />
        ) : (
          <View style={[styles.card, { backgroundColor: t.color.plate, gap: space.s12 }]}>
            <Txt kind="label" color="ink2" nativeID="reason-label">
              {tr("M-BD-01.reason")}
            </Txt>
            <TextInput
              accessibilityLabelledBy="reason-label"
              accessibilityLabel={tr("M-BD-01.reason")}
              value={reason}
              onChangeText={setReason}
              multiline
              maxLength={280}
              style={[
                styles.reason,
                {
                  color: t.color.ink,
                  borderColor: t.color.ink3,
                  backgroundColor: t.color.plate2,
                  fontFamily: "MonaSans_400Regular",
                },
              ]}
            />
            <View style={{ flexDirection: "row", gap: space.s8, justifyContent: "flex-end" }}>
              <Button variant="text" label={tr("common.cancel")} onPress={() => setSendBack("closed")} />
              <Button
                label={tr("M-BD-01.sendBackConfirm")}
                disabled={reason.trim().length < 3 || sendBack === "sending"}
                onPress={async () => {
                  setSendBack("sending");
                  const r = await api.declineApproval(dto.runSlug, { role: "CHAIR", reason: reason.trim() });
                  setSendBack(r.ok ? "sent" : "open");
                }}
                testID="M-BD-01.send-back.confirm"
              />
            </View>
          </View>
        )
      ) : null}
      <Txt kind="caption" color="ink3">
        {tr("M-BD-01.expires", {
          batch: dto.senderBatchId,
          time: `${format.dayMonth(dto.expiresAt, lang)} ${format.time(dto.expiresAt)}`,
        })}
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.s16, gap: space.s12, borderRadius: radius.none },
  sealCard: { alignItems: "center" },
  hold: { flexDirection: "row", alignItems: "flex-start", gap: space.s12 },
  item: { flexDirection: "row", alignItems: "center", minHeight: 28 },
  key: { flexDirection: "row", alignItems: "center", gap: space.s8 },
  reason: {
    minHeight: 80,
    borderWidth: 1,
    borderRadius: radius.plate,
    padding: space.s12,
    fontSize: 16,
    textAlignVertical: "top",
  },
});
