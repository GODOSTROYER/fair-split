/**
 * M-MB-04 Pangutana: who to ask, where and when; the member's right to see records (RA 9520 Art. 83); and
 * "Ipasusi pag-usab", which sends the line, a slip and an optional note to the Mediation and Conciliation
 * Committee (Art. 43). States: none, sent, answered.
 */
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { format } from "../../_shims/domain";
import { cashDayIso, people } from "../../_shims/seed";
import { radius, space } from "../../_shims/tokens.native";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Screen } from "../../ui/chrome";
import { Banner, Chip, InkStamp, MachineTranslatedNote, SectionTitle } from "../../ui/primitives";
import { figures, Sentence } from "../../ui/sentence";
import { Slab } from "../../ui/slab";
import { Txt, useT } from "../../ui/text";
import { useStatement } from "./use-statement";

export function PangutanaScreen() {
  const { api, lang, session } = useApp();
  const isMember = session?.role === "member";
  const { t } = useFs();
  const tr = useT();
  const { dto } = useStatement();
  const [slip, setSlip] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"none" | "sending" | "sent" | "failed">("none");

  const send = async () => {
    if (!dto || state === "sending") return;
    setState("sending");
    const r = await api.postReviewRequest({
      lineId: dto.lineId,
      slip: slip ?? undefined,
      note: note.trim() || undefined,
    });
    setState(r.ok ? "sent" : "failed");
  };

  return (
    <Screen testID="M-MB-04" state={state === "sending" ? "none" : state}>
      <Txt kind="title1" accessibilityRole="header">
        {tr("M-MB-04.title")}
      </Txt>

      <View style={[styles.card, { backgroundColor: t.color.plate }]}>
        <SectionTitle>{tr("M-MB-04.whoTitle")}</SectionTitle>
        <View style={styles.who}>
          <InkStamp initials={people.treasurer.initials} label={people.treasurer.name} />
          <View style={{ flex: 1 }}>
            <Txt kind="title2">{`Treasurer ${dto?.treasurer.name ?? people.treasurer.name}`}</Txt>
            <Txt kind="body" color="ink2">
              {tr("M-MB-04.where")}
            </Txt>
          </View>
        </View>
        <Sentence
          segments={figures(tr("M-MB-04.when", { date: format.date(dto?.cashDay ?? cashDayIso, lang) }))}
        />
      </View>

      <View style={{ gap: space.s4 }}>
        <Txt kind="statementBody">{tr("M-MB-04.rights")}</Txt>
        <Txt kind="caption" color="ink3">
          {tr("M-MB-04.rightsCite")}
        </Txt>
      </View>

      {isMember ? (
        <View style={[styles.card, { backgroundColor: t.color.plate }]}>
          <Txt kind="title2" accessibilityRole="header">
            {tr("M-MB-04.recheckTitle")}
          </Txt>
          <Txt kind="body" color="ink2">
            {tr("M-MB-04.recheckBody")}
          </Txt>
          {state === "sent" ? (
            <View style={styles.sent} testID="M-MB-04.sent">
              <InkStamp initials="MC" label="Mediation and Conciliation Committee" />
              <Txt kind="bodyStrong">{tr("M-MB-04.sent")}</Txt>
            </View>
          ) : (
            <>
              <Txt kind="label" color="ink2">
                {tr("M-MB-04.pickSlip")}
              </Txt>
              <View style={styles.chips}>
                <Chip
                  label={tr("M-MB-04.wholeLine")}
                  selected={slip === null}
                  onPress={() => setSlip(null)}
                />
                {dto?.slips.map((s) => (
                  <Chip
                    key={s.serial}
                    icon="slip"
                    label={s.serial}
                    selected={slip === s.serial}
                    onPress={() => setSlip(s.serial)}
                    testID={`M-MB-04.slip.${s.serial}`}
                  />
                ))}
              </View>
              <TextInput
                testID="M-MB-04.note"
                value={note}
                onChangeText={setNote}
                multiline
                maxLength={280}
                accessibilityLabel={tr("M-MB-04.note")}
                placeholder={tr("M-MB-04.note")}
                placeholderTextColor={t.color.ink3}
                style={[
                  styles.note,
                  {
                    color: t.color.ink,
                    borderColor: t.color.ink3,
                    backgroundColor: t.color.plate2,
                    fontFamily: "AtkinsonHyperlegibleNext_400Regular",
                  },
                ]}
              />
              {state === "failed" ? (
                <Banner tone="decide" icon="wifiOff">
                  <Txt kind="body">{tr("M-MB-04.failed")}</Txt>
                </Banner>
              ) : null}
              <Slab
                testID="M-MB-04.send"
                label={state === "sending" ? tr("M-MB-04.sending") : tr("M-MB-04.send")}
                depth="d1"
                tone="chalk"
                srLabel={tr("M-MB-04.send")}
                disabled={!dto || state === "sending"}
                onCommit={() => void send()}
              />
            </>
          )}
        </View>
      ) : null}
      <MachineTranslatedNote />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.s16, gap: space.s12, borderRadius: radius.none },
  who: { flexDirection: "row", alignItems: "center", gap: space.s12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.s8 },
  note: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: radius.plate,
    padding: space.s12,
    fontSize: 18,
    lineHeight: 26,
    textAlignVertical: "top",
  },
  sent: { flexDirection: "row", alignItems: "center", gap: space.s12, paddingVertical: space.s8 },
});
