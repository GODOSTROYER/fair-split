/**
 * M-CL-02 Outbox (design K1 "the outbox: thumbnail, serial, member hint, file size and a progress ring per slip"):
 * everything this phone has filed, in the order things happen. What is still on the phone comes first, in the
 * order it will go (cash receipts first, then oldest first); then what reached the co-op today; then earlier.
 * Each capture says where it is in words, and one waiting on a retry or a person offers "Ipadala karon".
 */
import { router } from "expo-router";
import { Fragment } from "react";
import { StyleSheet, View } from "react-native";
import { radius, space } from "../../_shims/tokens.native";
import { type CaptureRecord, MANUAL_ONLY, summarise } from "../../lib/outbox";
import { HREF } from "../../services/session";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Screen, TopBar } from "../../ui/chrome";
import { Banner, Button, Rule, SectionTitle } from "../../ui/primitives";
import { EmptyState, Skeleton } from "../../ui/states";
import { Txt } from "../../ui/text";
import { CaptureRow } from "./capture-row";
import { sectionsOf } from "./capture-view";
import type { ClerkKey } from "./messages";
import { pluralKey } from "./messages";
import { useOutbox } from "./outbox-provider";
import { outboxScreenState } from "./screen-state";
import { useNow } from "./use-now";
import { useT } from "./use-t";

export function OutboxScreen() {
  const { online } = useApp();
  const tr = useT();
  const outbox = useOutbox();
  const { records } = outbox;
  const now = useNow(
    records.some((r) => r.state === "uploading" || (r.state === "failed" && r.nextAttemptAt !== MANUAL_ONLY)),
  );
  const sections = sectionsOf(records, now);
  const sum = summarise(records);
  const state = outboxScreenState({ online, records });
  const waiting = sum.retrying + sum.refused;

  return (
    <View style={{ flex: 1 }}>
      <TopBar title={tr("M-CL-02.title")} />
      <Screen testID="M-CL-02" state={state} topInset={false}>
        {outbox.status === "opening" ? <Skeleton lines={3} block={64} /> : null}

        {outbox.status === "error" ? (
          <Banner
            tone="decide"
            icon="info"
            action={<Button variant="text" label={tr("common.tryAgain")} onPress={outbox.reopen} />}
          >
            <Txt kind="bodyStrong">{tr("common.error")}</Txt>
          </Banner>
        ) : null}

        {outbox.status === "ready" && records.length === 0 ? (
          <EmptyState
            glyph="outbox"
            title={tr("M-CL-02.emptyTitle")}
            body={tr("M-CL-02.emptyBody")}
            testID="M-CL-02.empty"
            action={
              <Button
                icon="scan"
                label={tr("M-CL-01.scan")}
                onPress={() => router.navigate(HREF.scan)}
                testID="M-CL-02.scan"
              />
            }
          />
        ) : null}

        {records.length ? (
          <View style={styles.summary}>
            <Txt kind="bodyStrong" testID="M-CL-02.summary" style={{ flex: 1 }}>
              {sections.phone.length
                ? tr("M-CL-02.summary", { phone: sections.phone.length, sent: sections.today.length })
                : tr("M-CL-02.summaryClear", { sent: sections.today.length })}
            </Txt>
            {online && waiting ? (
              <Button
                variant="tonal"
                icon="forward"
                label={tr("M-CL-02.sendAll")}
                onPress={outbox.sendAll}
                testID="M-CL-02.send-all"
              />
            ) : null}
          </View>
        ) : null}

        {!online && sum.onPhone ? (
          <Banner icon="wifiOff" testID="M-CL-02.offline">
            <Txt kind="bodyStrong">{tr(pluralKey("M-CL-01.offline", sum.onPhone), { n: sum.onPhone })}</Txt>
            <Txt kind="body" color="ink2">
              {tr("M-CL-01.offlineAfter")}
            </Txt>
          </Banner>
        ) : null}

        <Section
          title="M-CL-02.sectionPhone"
          rows={sections.phone}
          now={now}
          online={online}
          onSendNow={outbox.sendNow}
          testID="M-CL-02.phone"
        />
        <Section
          title="M-CL-02.sectionToday"
          rows={sections.today}
          now={now}
          online={online}
          onSendNow={outbox.sendNow}
          testID="M-CL-02.today"
        />
        <Section
          title="M-CL-02.sectionEarlier"
          rows={sections.earlier}
          now={now}
          online={online}
          onSendNow={outbox.sendNow}
          testID="M-CL-02.earlier"
        />
      </Screen>
    </View>
  );
}

function Section({
  title,
  rows,
  now,
  online,
  onSendNow,
  testID,
}: {
  title: ClerkKey;
  rows: readonly CaptureRecord[];
  now: number;
  online: boolean;
  onSendNow(id: string): void;
  testID: string;
}) {
  const { t } = useFs();
  const tr = useT();
  if (rows.length === 0) return null;
  return (
    <View testID={testID}>
      <SectionTitle>{tr(title)}</SectionTitle>
      <View style={[styles.plate, { backgroundColor: t.color.plate }]}>
        {rows.map((r, i) => (
          <Fragment key={r.id}>
            {i > 0 ? <Rule /> : null}
            <CaptureRow
              r={r}
              now={now}
              online={online}
              onSendNow={() => onSendNow(r.id)}
              testID={`M-CL-02.row.${r.id}`}
            />
          </Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: "row", alignItems: "center", gap: space.s12, flexWrap: "wrap" },
  plate: { borderRadius: radius.plate, paddingHorizontal: space.s12 },
});
