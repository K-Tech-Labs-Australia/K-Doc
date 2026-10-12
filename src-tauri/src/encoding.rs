//! @purpose Detects and re-encodes the text encodings K-Doc preserves through its save round trip (FR-6.6).
//! @inputs Raw file bytes read from disk; a wire encoding name sent by the webview.
//! @outputs An Encoding plus a BOM-stripped payload; decoded String values; encoded byte vectors with BOMs restored.
//! @functions detect - Classifies bytes and strips any leading BOM. decode - Turns a payload into a String for an encoding. encode - Turns a String back into bytes, restoring the BOM. as_str / from_str - Wire-name to Encoding conversion on the Encoding type.
//! @dataflow Disk bytes → detect → (Encoding, payload) → decode → String; webview text → encode → bytes with BOM → disk.
//! @controlflow Detection inspects UTF-8's three-byte BOM before the two-byte UTF-16 prefixes to avoid ambiguity; decode branches on encoding and encode reverses it.
//! @version 1
//! @date 2026-09-11

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    /// UTF-8 with no byte order mark. The default for a file that announces nothing.
    Utf8,
    /// UTF-8 preceded by EF BB BF.
    Utf8Bom,
    /// UTF-16 little-endian, preceded by FF FE.
    Utf16Le,
    /// UTF-16 big-endian, preceded by FE FF.
    Utf16Be,
}

impl Encoding {
    /// The wire name sent to the webview, and the one it sends back.
    /// @purpose Returns the canonical wire string for this encoding used in both directions of the webview protocol.
    /// @inputs self - The encoding whose wire name is requested.
    /// @outputs A static string literal: "utf-8", "utf-8-bom", "utf-16le", or "utf-16be".
    /// @dataflow Self → match on variant → selected &'static str.
    /// @controlflow One arm per encoding variant, each returning its fixed wire name.
    pub fn as_str(self) -> &'static str {
        match self {
            // Plain UTF-8 is the default wire name with no suffix.
            Encoding::Utf8 => "utf-8",
            // UTF-8 with a BOM carries an explicit "-bom" suffix so it is never confused with plain Utf8.
            Encoding::Utf8Bom => "utf-8-bom",
            // Little-endian UTF-16 wire name.
            Encoding::Utf16Le => "utf-16le",
            // Big-endian UTF-16 wire name.
            Encoding::Utf16Be => "utf-16be",
        }
    }

    /// Parses a wire name, falling back to UTF-8 for anything unrecognised.
    /// @purpose Maps a webview-supplied string back to an Encoding, defaulting safely on unknown input.
    /// @inputs name - The wire name received from the webview.
    /// @outputs The matching Encoding, or Encoding::Utf8 when the name is not one of the four recognised values.
    /// @dataflow Incoming &str → match against known names → selected variant or Utf8 fallback.
    /// @controlflow Four arms map known names to their variants; the catch-all arm returns Utf8 for anything else.
    pub fn from_str(name: &str) -> Encoding {
        match name {
            // The four recognised wire names map straight back to their variants.
            "utf-8" => Encoding::Utf8,
            "utf-8-bom" => Encoding::Utf8Bom,
            "utf-16le" => Encoding::Utf16Le,
            "utf-16be" => Encoding::Utf16Be,
            // An unknown name from the webview means a version mismatch between the Rust side and the
            // webview. Writing UTF-8 is the one outcome that cannot corrupt a file that was already UTF-8,
            // so it is the safe default.
            _ => Encoding::Utf8,
        }
    }
}

/// Detects the encoding from a byte order mark and returns the payload with any BOM removed.
/// @purpose Classifies bytes as one of the four recognised encodings by inspecting their leading bytes.
/// @inputs bytes - The raw file contents, possibly prefixed with a BOM.
/// @outputs A tuple of the detected Encoding and the payload slice with any leading BOM stripped.
/// @dataflow Leading bytes → BOM comparison → (Encoding, remaining payload).
/// @controlflow Checks UTF-8's three-byte BOM first, then each UTF-16 two-byte prefix; falls back to Utf8 when none match.
pub fn detect(bytes: &[u8]) -> (Encoding, &[u8]) {
    // Check the three-byte UTF-8 BOM before the two-byte UTF-16 prefixes: EF BB BF cannot be confused with either FF FE or FE FF because its first byte differs from both.
    // Checking the short prefixes first would be a trap if a future encoding shared one of those leading bytes, so the longer, more specific match goes first.
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        // UTF-8 BOM present: report Utf8Bom and drop the three-byte prefix.
        (Encoding::Utf8Bom, &bytes[3..])
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        // Little-endian UTF-16 BOM present: report Utf16Le and drop the two-byte prefix.
        (Encoding::Utf16Le, &bytes[2..])
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        // Big-endian UTF-16 BOM present: report Utf16Be and drop the two-byte prefix.
        (Encoding::Utf16Be, &bytes[2..])
    } else {
        // No recognised BOM: treat as plain UTF-8, the default for a file that announces nothing.
        (Encoding::Utf8, bytes)
    }
}

/// Decodes a payload into a String for the given encoding.
/// @purpose Converts stored bytes back into Rust text, validating structure along the way.
/// @inputs encoding - The encoding the payload was written in. payload - The BOM-stripped byte slice.
/// @outputs Ok(String) on success, or Err describing why decoding failed.
/// @dataflow Payload bytes → per-encoding unit extraction → String construction → result.
/// @controlflow Branches on encoding: UTF-8 variants validate as UTF-8; UTF-16 variants reject odd lengths then pair the bytes before decoding.
pub fn decode(encoding: Encoding, payload: &[u8]) -> Result<String, String> {
    match encoding {
        // Plain and BOM-prefixed UTF-8 share the same already-stripped payload here.
        Encoding::Utf8 | Encoding::Utf8Bom => {
            // Validate the bytes as UTF-8; on failure map to a message that the file is not valid UTF-8.
            String::from_utf8(payload.to_vec()).map_err(|_| "file is not valid UTF-8".to_string())
        }
        // Little-endian UTF-16: an odd byte count cannot form complete code units, so reject it before pairing.
        Encoding::Utf16Le => {
            if payload.len() % 2 != 0 {
                // Odd length: a UTF-16 file must have an even number of bytes to contain whole code units.
                return Err("UTF-16 file must have an even number of bytes".to_string());
            }
            // chunks_exact(2) pairs each two consecutive bytes; the odd-length check above proves the remainder is empty, so no byte is dropped.
            let units: Vec<u16> = payload
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            // Decode the code units; map a surrogate error to a descriptive message.
            String::from_utf16(&units).map_err(|_| "UTF-16 payload contains an invalid surrogate".to_string())
        }
        // Big-endian UTF-16: an odd byte count cannot form complete code units, so reject it before pairing.
        Encoding::Utf16Be => {
            if payload.len() % 2 != 0 {
                // Odd length: a UTF-16 file must have an even number of bytes to contain whole code units.
                return Err("UTF-16 file must have an even number of bytes".to_string());
            }
            // chunks_exact(2) pairs each two consecutive bytes; the odd-length check above proves the remainder is empty, so no byte is dropped.
            let units: Vec<u16> = payload
                .chunks_exact(2)
                .map(|c| u16::from_be_bytes([c[0], c[1]]))
                .collect();
            // Decode the code units; map a surrogate error to a descriptive message.
            String::from_utf16(&units).map_err(|_| "UTF-16 payload contains an invalid surrogate".to_string())
        }
    }
}

/// Encodes a String back into bytes, restoring the BOM for every encoding that had one.
/// @purpose Reverses decode so a save writes the file back exactly as it was found; the BOM is written back because it is part of how the file was found, not a preference.
/// @inputs encoding - The encoding to write in. text - The Rust string to serialise.
/// @outputs A byte vector containing the encoded body and, where applicable, the leading BOM.
/// @dataflow String → UTF-16/UTF-8 unit extraction → bytes with BOM prepended.
/// @controlflow Branches on encoding: each variant emits its own BOM (if any) followed by the encoded body.
pub fn encode(encoding: Encoding, text: &str) -> Vec<u8> {
    match encoding {
        // Plain UTF-8: no BOM is written because none was present when the file was found.
        Encoding::Utf8 => text.as_bytes().to_vec(),
        // UTF-8 with a BOM: restore EF BB BF before the UTF-8 body so the round trip is byte-identical.
        Encoding::Utf8Bom => {
            let mut out = Vec::with_capacity(3 + text.len());
            out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            out.extend_from_slice(text.as_bytes());
            out
        }
        // Little-endian UTF-16: restore FF FE before each code unit serialised little-endian.
        Encoding::Utf16Le => {
            let mut out = Vec::with_capacity(2 + text.len() * 2);
            out.extend_from_slice(&[0xFF, 0xFE]);
            for unit in text.encode_utf16() {
                // Write each code unit little-endian so it matches how the file was found.
                out.extend_from_slice(&unit.to_le_bytes());
            }
            out
        }
        // Big-endian UTF-16: restore FE FF before each code unit serialised big-endian.
        Encoding::Utf16Be => {
            let mut out = Vec::with_capacity(2 + text.len() * 2);
            out.extend_from_slice(&[0xFE, 0xFF]);
            for unit in text.encode_utf16() {
                // Write each code unit big-endian so it matches how the file was found.
                out.extend_from_slice(&unit.to_be_bytes());
            }
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_plain_bytes_as_utf8() {
        // Plain bytes with no BOM must be reported as Utf8 and returned unchanged.
        let bytes = b"hello".to_vec();
        let (encoding, payload) = detect(&bytes);
        assert_eq!(encoding, Encoding::Utf8);
        assert_eq!(payload, &b"hello"[..]);
    }

    #[test]
    fn detects_utf8_bom_and_strips_it() {
        // EF BB BF followed by "hi" must be reported as Utf8Bom with the BOM removed.
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(b"hi");
        let (encoding, payload) = detect(&bytes);
        assert_eq!(encoding, Encoding::Utf8Bom);
        assert_eq!(payload, b"hi");
    }

    #[test]
    fn detects_utf16le_bom_and_strips_it() {
        // FF FE followed by UTF-16LE "hi" must be reported as Utf16Le with the BOM removed.
        let mut bytes = vec![0xFF, 0xFE];
        bytes.extend_from_slice(
            &"hi"
                .encode_utf16()
                .flat_map(u16::to_le_bytes)
                .collect::<Vec<u8>>(),
        );
        let (encoding, payload) = detect(&bytes);
        assert_eq!(encoding, Encoding::Utf16Le);
        // The two-byte BOM is stripped; the remaining four bytes are the two code units.
        assert_eq!(payload.len(), 4);
    }

    #[test]
    fn detects_utf16be_bom_and_strips_it() {
        // FE FF followed by UTF-16BE "hi" must be reported as Utf16Be with the BOM removed.
        let mut bytes = vec![0xFE, 0xFF];
        bytes.extend_from_slice(
            &"hi"
                .encode_utf16()
                .flat_map(u16::to_be_bytes)
                .collect::<Vec<u8>>(),
        );
        let (encoding, payload) = detect(&bytes);
        assert_eq!(encoding, Encoding::Utf16Be);
        // The two-byte BOM is stripped; the remaining four bytes are the two code units.
        assert_eq!(payload.len(), 4);
    }

    #[test]
    fn round_trips_all_four_encodings() {
        // This is the property that matters: what K-Doc writes, K-Doc reads back identically.
        let encodings = [
            Encoding::Utf8,
            Encoding::Utf8Bom,
            Encoding::Utf16Le,
            Encoding::Utf16Be,
        ];
        for enc in encodings {
            let text = "Hello, world";
            // Encode the text (which writes the BOM), then detect on those exact bytes to recover both encoding and payload.
            let bytes = encode(enc, text);
            let (found, payload) = detect(&bytes);
            assert_eq!(found, enc);
            assert_eq!(decode(found, payload).unwrap(), text);
        }
    }

    #[test]
    fn rejects_odd_length_utf16() {
        // A single byte cannot form a UTF-16 code unit and must be rejected with an even-length message.
        let result = decode(Encoding::Utf16Le, &[0x41]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("even"));
    }

    #[test]
    fn from_str_falls_back_to_utf8() {
        // An unrecognised wire name (a version mismatch) must fall back to UTF-8 rather than error.
        assert_eq!(Encoding::from_str("nonsense"), Encoding::Utf8);
    }

    #[test]
    fn round_trips_non_bmp_characters_in_utf16() {
        // A surrogate pair is two u16 units and the naive "one char is one unit" assumption breaks exactly here.
        let text = "\u{1F600}"; // a non-BMP emoji: one Rust char, two UTF-16 units
        for enc in [Encoding::Utf16Le, Encoding::Utf16Be] {
            let bytes = encode(enc, text);
            let (found, payload) = detect(&bytes);
            assert_eq!(found, enc);
            assert_eq!(decode(found, payload).unwrap(), text);
        }
    }
}
