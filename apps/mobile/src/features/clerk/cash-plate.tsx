/**
 * Cash at the bodega (M-CL-01, cash day): who is due and who has received, with exact pesos at the run's rate
 * ("₱7,990.00", never an estimate) and the member's own status words. Hatching marks cash, always with the word.
 * The list counts people, never pesos (pesos are never summed). A due row opens the "Nadawat" receipt.
 *
 * The plate exists only when there is a list to show, or one that could not be fetched: a co-op with no cash list
 * for this phone shows no plate, and none flashes up while the first answer is on its way.
 */
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { amountStateOf, MEMBER_STATUS_WORDS, type MemberStatus } from "../../_shims/contracts";
import { format } from "../../_shims/domain";
import { radius, space, target } from "../../_shims/tokens.native";
import { STATUS_GLYPH, type StatusTone } from "../../lib/item-status";
import { payoutStatus } from "../../lib/payout-status";
import { useApp } from "../../state/app";
import { typeScale, useFs } from "../../theme/theme";
import { AmountDisplay } from "../../ui/amount";
import { Glyph } from "../../ui/glyph";
import { Banner, Button, Hatch, InkStamp, Rule, StatusDot } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import { type LocalReceipt, memberStatusOf, type RosterEntry, rosterCounts, searchRoster } from "./cash-day";
import type { CashHandle } from "./cash-provider";
import type { ClerkKey } from "./messages";
import { useCompact } from "./use-compact";
import { useT } from "./use-t";

/** Search appears once the list is longer than a glance. */
const SEARCH_FROM = 7;

export const LOCAL_WORD: Readonly<Record<Exclude<LocalReceipt, "none">, ClerkKey>> = {
  "on-phone": "M-CL-01.cash.onPhone",
  sending: "M-CL-01.cash.sending",
  sent: "M-CL-01.cash.recorded",
  refused: "M-CL-01.cash.refused",
};

export function CashPlate({ cash, onOpen }: { cash: CashHandle; onOpen(entry: RosterEntry): void }) {
  const { t } = useFs();
  const tr = useT();
  const { lang, online } = useApp();
  const [query, setQuery] = useState("");
  const { day, entries } = cash;
  const counts = rosterCounts(entries);
  const shown = query ? searchRoster(entries, query) : entries;

  if (!day && cash.status !== "error") return null;
  const repair = cash.error === "UNAUTHENTICATED";

  return (
    <View
      testID="M-CL-01.cash"
      dataSet={{ status: cash.status }}
      style={[styles.plate, { backgroundColor: t.color.plate, boxShadow: t.shadow.e1 }]}
    >
      <View style={styles.head}>
        {/* Cash is the hatch swatch and the word (decision §4): the swatch beside the title, never a band. */}
        <View style={styles.titleRow}>
          <View style={[styles.swatch, { borderColor: t.color.ruleStrong }]} aria-hidden>
            <Hatch />
          </View>
          <Txt kind="title2" accessibilityRole="header" style={styles.title}>
            {tr("M-CL-01.cash.title")}
          </Txt>
        </View>
        {day ? (
          <Txt kind="body" color="ink2" testID="M-CL-01.cash.summary">
            {[
              tr("M-CL-01.cash.day", { date: format.dayMonth(day.cashDay, lang) }),
              entries.length
                ? tr("M-CL-01.cash.progress", { received: counts.received, total: counts.total })
                : null,
            ]
              .filter(Boolean)
              .join(". ")}
          </Txt>
        ) : null}
        {cash.stale && day && cash.fetchedAt ? (
          <View style={styles.stale}>
            <Glyph name={online ? "clock" : "wifiOff"} size={16} color={t.color.ink2} />
            <Txt kind="caption" color="ink2" testID="M-CL-01.cash.stale">
              {tr(online ? "M-CL-01.cash.lastList" : "M-CL-01.cash.stale", {
                time: format.time(new Date(cash.fetchedAt).toISOString()),
              })}
            </Txt>
          </View>
        ) : null}
      </View>

      {cash.status === "error" && !day ? (
        <View style={styles.pad}>
          <Banner
            icon={repair ? "qr" : "info"}
            testID="M-CL-01.cash.error"
            action={
              repair ? undefined : (
                <Button variant="text" label={tr("common.tryAgain")} onPress={cash.reload} />
              )
            }
          >
            <Txt kind="body">{tr(repair ? "M-CL-01.cash.loadAuth" : "M-CL-01.cash.loadError")}</Txt>
          </Banner>
        </View>
      ) : null}

      {day && entries.length === 0 ? (
        <Txt kind="body" color="ink2" style={styles.pad} testID="M-CL-01.cash.none">
          {tr("M-CL-01.cash.none")}
        </Txt>
      ) : null}

      {entries.length >= SEARCH_FROM ? (
        <View style={[styles.search, { borderColor: t.color.steelLine, backgroundColor: t.color.plate2 }]}>
          <Glyph name="people" size={20} color={t.color.ink2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={tr("M-CL-01.cash.search")}
            placeholderTextColor={t.color.ink3}
            accessibilityLabel={tr("M-CL-01.cash.search")}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            testID="M-CL-01.cash.search"
            style={[styles.input, { color: t.color.ink }]}
          />
        </View>
      ) : null}

      {query && shown.length === 0 ? (
        <Txt kind="body" color="ink2" style={styles.pad}>
          {tr("M-CL-01.cash.noMatch", { q: query.trim() })}
        </Txt>
      ) : null}

      {shown.map((e, i) => (
        <View key={e.line.lineId}>
          {i > 0 ? <Rule /> : null}
          <CashRow entry={e} phpPerUsd={day?.phpPerUsd ?? "0"} onPress={() => onOpen(e)} />
        </View>
      ))}
    </View>
  );
}

function CashRow({ entry, phpPerUsd, onPress }: { entry: RosterEntry; phpPerUsd: string; onPress(): void }) {
  const { t } = useFs();
  const tr = useT();
  const { lang } = useApp();
  const compact = useCompact();
  const { line } = entry;
  const status = memberStatusOf(entry);
  const pesos = format.cashPesos(line.cents, phpPerUsd);
  const received = entry.status === "received";
  const projection = payoutStatus(
    {
      status,
      statusWord: MEMBER_STATUS_WORDS[status][lang],
      amountState: received ? "attested" : amountStateOf(line.lineState, { approved: true }),
      paypal: false,
      evidence: [],
    },
    lang,
  );
  const word = projection.statusWord;
  const local = entry.local === "none" ? null : tr(LOCAL_WORD[entry.local]);
  const when =
    received && entry.receivedAt
      ? tr("M-CL-01.cash.receivedBy", { time: format.time(new Date(entry.receivedAt).toISOString()) })
      : null;
  const sub = [line.memberNo, line.movedFromPayPal ? tr("M-CL-01.cash.movedFromPayPal") : null, when, local]
    .filter(Boolean)
    .join(", ");
  const subColour = entry.local === "refused" ? t.color.canaryText : t.color.ink2;
  const amount = (
    <AmountDisplay
      text={pesos}
      srLabel={format.cashSpoken(line.cents, phpPerUsd)}
      state={projection.amountState}
      size="figure"
    />
  );
  const stamp = received && entry.receivedBy ? <InkStamp initials={entry.receivedBy} /> : null;
  const chip = (
    <CashChip
      status={status}
      word={word}
      tone={projection.tone}
      testID={`M-CL-01.cash.line.${line.memberNo}.chip`}
    />
  );
  return (
    <Pressable
      testID={`M-CL-01.cash.line.${line.memberNo}`}
      dataSet={{ cashState: entry.status, receipt: entry.local }}
      accessibilityRole="button"
      accessibilityLabel={tr("M-CL-01.cash.rowSr", {
        name: line.name,
        member: line.memberNo,
        amount: format.cashSpoken(line.cents, phpPerUsd),
        status: [word, when, local].filter(Boolean).join(", "),
      })}
      accessibilityHint={received ? undefined : tr("M-CL-01.cash.rowHint")}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.color.pencilWash }]}
    >
      {compact ? (
        // One column at large text or on a narrow window: nothing is clipped, the row stays one button.
        <View style={{ flex: 1, gap: space.s4 }}>
          <Txt kind="bodyStrong">{line.name}</Txt>
          <View style={styles.amountLine}>
            {amount}
            {stamp}
          </View>
          <Txt kind="caption" style={{ color: subColour }}>
            {sub}
          </Txt>
          <View style={styles.chipLine}>{chip}</View>
        </View>
      ) : (
        <>
          <View style={{ flex: 1, gap: space.s4 }}>
            <View style={styles.rowTop}>
              <Txt kind="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
                {line.name}
              </Txt>
              {amount}
              {stamp}
            </View>
            <View style={styles.rowBottom}>
              <Txt kind="caption" style={{ flex: 1, color: subColour }}>
                {sub}
              </Txt>
              {chip}
            </View>
          </View>
          <Glyph name="chevron" size={20} color={t.color.ink3} />
        </>
      )}
    </Pressable>
  );
}

/**
 * The member's status word as the shared chip draws it (UI gate round 2: a white pill whose colour lives only in its
 * dot, a hatch swatch for cash; never colour alone), except that the word wraps: at 2× text "Handa na po sa bodega"
 * must never be clipped.
 */
function CashChip({
  status,
  word,
  tone,
  testID,
}: {
  status: MemberStatus;
  word: string;
  tone: StatusTone;
  testID: string;
}) {
  const { t } = useFs();
  const fg = tone === "decide" || tone === "cash" ? t.color.ink : t.color.ink2;
  return (
    <View
      testID={testID}
      dataSet={{ state: status, tone, glyph: STATUS_GLYPH[status] }}
      accessible
      accessibilityRole="text"
      accessibilityLabel={word}
      style={[styles.chip, { backgroundColor: t.color.plate, borderColor: t.color.ruleStrong }]}
    >
      <StatusDot tone={tone === "decide" || tone === "cash" ? tone : "neutral"} />
      <Txt kind="label" style={{ color: fg, flexShrink: 1 }}>
        {word}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    flexShrink: 1,
    maxWidth: "100%",
    gap: space.s8,
    minHeight: 28,
    paddingLeft: space.s8 + 2,
    paddingRight: space.s12,
    paddingVertical: space.s2,
    borderWidth: 1,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  plate: { borderRadius: radius.card, overflow: "hidden", paddingBottom: space.s8 },
  head: { gap: space.s4, paddingHorizontal: space.s16, paddingTop: space.s16, paddingBottom: space.s8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.s8 },
  swatch: { width: 18, height: 18, borderWidth: 1, borderRadius: 4, overflow: "hidden" },
  title: { flexShrink: 1 },
  stale: { flexDirection: "row", alignItems: "center", gap: space.s4 },
  pad: { paddingHorizontal: space.s16, paddingVertical: space.s8 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s8,
    marginHorizontal: space.s16,
    marginVertical: space.s8,
    paddingHorizontal: space.s12,
    minHeight: target.min,
    borderWidth: 1,
    borderRadius: radius.control,
  },
  input: { flex: 1, minHeight: target.min, ...typeScale.body },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    paddingHorizontal: space.s16,
    paddingVertical: space.s12,
    minHeight: target.min + space.s16,
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: space.s8 },
  amountLine: { flexDirection: "row", alignItems: "center", gap: space.s8 },
  chipLine: { flexDirection: "row", maxWidth: "100%" },
  rowBottom: { flexDirection: "row", alignItems: "center", gap: space.s8, flexWrap: "wrap" },
});
