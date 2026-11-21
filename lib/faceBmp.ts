/** 8×8 RGB (base64) als BMP-Daten-URL (~330 Zeichen statt ~7 KB als SVG; scharf skaliert per CSS `image-rendering`) */
export function faceUrl(b64: string): string {
  const bin = atob(b64);
  // 54 Byte Kopf + 8 Zeilen à 24 Byte (durch 4 teilbar, kein Auffüllen), Zeilen von unten nach oben, Farben als BGR
  const head = [0x42, 0x4d, 246, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0, 40, 0, 0, 0, 8, 0, 0, 0, 8, 0, 0, 0, 1, 0, 24, 0, 0, 0, 0, 0, 192, 0, 0, 0, 0x13, 0x0b, 0, 0, 0x13, 0x0b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let out = String.fromCharCode(...head);
  for (let y = 7; y >= 0; y--)
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 3;
      out += bin[i + 2] + bin[i + 1] + bin[i];
    }
  return `data:image/bmp;base64,${btoa(out)}`;
}
