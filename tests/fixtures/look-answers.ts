// The model's answer to the upload's LOOK, for a stubbed `messages.create`.
//
// Since open intake (2026-11-20) a file with text is looked at by the SURVEY
// (`record_file_parts`) and a scan still by the file check
// (`record_document_kind`). A route test states what the model SAW once, in
// the file check's terms, and this answers whichever tool the request forces:
// the survey as ONE part covering the whole file, which is how the survey
// answers a single-kind file. Stating it twice, once per tool, would let the
// two answers drift and the test prove the drift.
type LookInput = {
  genre: string;
  titleText?: string | null;
  evidence: string;
  certain: boolean;
  weighedAgainst?: string | null;
};

type SurveyPartInput = {
  firstPage?: number | null;
  lastPage?: number | null;
  sheet?: string | null;
  firstRow?: number | null;
  lastRow?: number | null;
  genre: string;
  evidence: string;
  certain: boolean;
  weighedAgainst?: string | null;
  itemCodes?: string[];
  finishCodes?: string[];
  nothingToRead?: boolean;
};

const toolUse = (name: string, input: unknown) => ({
  content: [{ type: "tool_use", id: "t1", name, input }],
  stop_reason: "tool_use",
});

/** The survey's tool input for the given parts, every field present. */
export function surveyInput(parts: SurveyPartInput[], note: string | null = null) {
  return {
    parts: parts.map((part) => ({
      firstPage: null,
      lastPage: null,
      sheet: null,
      firstRow: null,
      lastRow: null,
      weighedAgainst: null,
      itemCodes: [],
      finishCodes: [],
      nothingToRead: false,
      ...part,
    })),
    note,
  };
}

/** A `create` implementation answering a single-kind file through either tool. */
export function lookAnswer(input: LookInput) {
  return async (request: { tool_choice?: { name?: string } }) => {
    if (request.tool_choice?.name === "record_file_parts") {
      return toolUse(
        "record_file_parts",
        surveyInput([{ genre: input.genre, evidence: input.evidence, certain: input.certain, weighedAgainst: input.weighedAgainst ?? null }]),
      );
    }
    return toolUse("record_document_kind", {
      genre: input.genre,
      titleText: input.titleText ?? null,
      evidence: input.evidence,
      certain: input.certain,
      weighedAgainst: input.weighedAgainst ?? null,
    });
  };
}

/** A `create` implementation answering the survey with these parts. */
export function surveyAnswer(parts: SurveyPartInput[], note: string | null = null) {
  return async () => toolUse("record_file_parts", surveyInput(parts, note));
}
