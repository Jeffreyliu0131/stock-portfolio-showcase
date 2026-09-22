/*
 * Financial providers commonly encode decimal values as JSON numbers.
 * Parsing them through Response.json() would first coerce the wire value to a
 * binary floating-point number. This scanner quotes every JSON number token
 * outside string literals before JSON.parse sees it, preserving its exact
 * decimal representation as a string.
 */
export function parseJsonPreservingNumbers(source: string): unknown {
  let transformed = "";
  let index = 0;

  while (index < source.length) {
    const character = source[index];
    if (character === '"') {
      transformed += character;
      index += 1;
      while (index < source.length) {
        const stringCharacter = source[index];
        transformed += stringCharacter;
        index += 1;
        if (stringCharacter === "\\") {
          if (index < source.length) {
            transformed += source[index];
            index += 1;
          }
          continue;
        }
        if (stringCharacter === '"') {
          break;
        }
      }
      continue;
    }

    if (
      character === "-" ||
      (character !== undefined &&
        character >= "0" &&
        character <= "9")
    ) {
      const numberMatch =
        /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
          source.slice(index),
        );
      if (numberMatch !== null) {
        transformed += `"${numberMatch[0]}"`;
        index += numberMatch[0].length;
        continue;
      }
    }

    transformed += character;
    index += 1;
  }

  return JSON.parse(transformed) as unknown;
}
