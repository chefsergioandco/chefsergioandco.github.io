/**
 * Gift codes: 16 characters from Crockford's Base32 alphabet (no I, L, O or U, so nothing reads as
 * another character), in four groups of four. Fifteen random characters carry 75 bits; the sixteenth is
 * a Luhn mod 32 check character, so any single mistyped character or swap of two neighbours is caught
 * before a request is sent. The server stores only a keyed hash of the code.
 */
export const GIFT_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ALIASES: Record<string, string> = { O: '0', I: '1', L: '1', U: 'V' }

function checkCharacter(body: string): string {
  const n = GIFT_CODE_ALPHABET.length
  let factor = 2, sum = 0
  for (let index = body.length - 1; index >= 0; index--) {
    let addend = factor * GIFT_CODE_ALPHABET.indexOf(body[index])
    factor = factor === 2 ? 1 : 2
    addend = Math.floor(addend / n) + (addend % n)
    sum += addend
  }
  return GIFT_CODE_ALPHABET[(n - (sum % n)) % n]
}

/** Reads what a person typed: any case, spaces or dashes, and the usual look-alikes (O→0, I/L→1, U→V). */
export function normalizeGiftCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').split('').map(char => ALIASES[char] ?? char).join('')
}

export function isGiftCode(input: string): boolean {
  const code = normalizeGiftCode(input)
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(code) && checkCharacter(code.slice(0, 15)) === code[15]
}

export function formatGiftCode(input: string): string {
  return normalizeGiftCode(input).replace(/(.{4})(?=.)/g, '$1 ')
}

/** Unbiased: 256 is a multiple of 32, so each byte maps evenly onto the alphabet. */
export function generateGiftCode(random: (bytes: Uint8Array) => Uint8Array = bytes => crypto.getRandomValues(bytes)): string {
  const body = [...random(new Uint8Array(15))].map(byte => GIFT_CODE_ALPHABET[byte % 32]).join('')
  return body + checkCharacter(body)
}
