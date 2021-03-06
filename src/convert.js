// -*- encoding: utf-8 -*-
import * as MRD from './MRD.js';
import {functionF,
        lchabToLab,
        labToLchab,
        labToXyz,
        xyzToLinearRgb,
        linearRgbToRgb,
        rgbToRgb255,
        rgbToHex,
        ILLUMINANT_C,
        ILLUMINANT_D65,
        SRGB} from './colorspace.js';
import {mod,
        clamp,
        polarToCartesian,
        circularLerp,
        multMatrixVector} from './arithmetic.js';

/**
 * @name mhvc
 * @global
 * @desc <code>mhvc</code>, or Munsell HVC, is a 3-number expression of Munsell
 * Color composed of [Hue, Value, Chroma]: e.g. <code>[94.2, 3.5, 11]</code>,
 * <code>[0, 10 ,0]</code>. Here Hue is in the circle group R/100Z: i.e. 0R (=
 * 10RP) corresponds to 0 (= 100 = 300 = -2000) and 2YR corresponds to 12 (= -88
 * = 412). Value is in the interval [0, 10] and the converters will clamp it if
 * a given value exceeds it. Chroma is non-negative and the converters will
 * assume it to be zero if a given chroma is negative. Note that every converter
 * accepts a huge chroma outside the Munsell Renotation Data (e.g. 1000000) and
 * returns a extrapolated result.
 */

/**
 * @name munsell
 * @global
 * @desc <code>munsell</code> is the standard string specification of the
 * Munsell Color: e.g. <code>"4.2RP 3.5/11"</code>, <code>"N 10"</code>. Here
 * various notations of numbers are accepted; an ugly specification like
 * <code>"2e-02RP .9/0xf"</code> (equivalent to <code>"0.02RP 0.9/15"</code>)
 * will be also available. However, the capital letters A-Z and the slash '/'
 * are reserved.
 */

/** 
 * Converts Munsell value to Y (of XYZ) based on the formula in the ASTM
 * D1535-18e1.
 * @param {number} value - will be in [0, 10]. Clamped if it exceeds the
 * interval.
 * @returns {number} Y
 */
export function munsellValueToY(v) {
  return v * (1.1914 + v * (-0.22533 + v * (0.23352 + v * (-0.020484 + v * 0.00081939)))) * 0.01;
}

/** Converts Munsell value to L* (of CIELAB).
 * @param {number} value - will be in [0, 10]. Clamped if it exceeds the
 * interval.
 * @returns {number} L*
 */
export function munsellValueToL(v) {
  return 116 * functionF(munsellValueToY(v)) - 16;
}

// These converters process a dark color (value < 1) separately because the
// values of the Munsell Renotation Data (all.dat) are not evenly distributed:
// [0, 0.2, 0.4, 0.6, 0.8, 1, 2, 3, ..., 10].

// In the following functions, the actual value equals scaledValue/5 if dark is
// true; the actual chroma equals to halfChroma*2.

function mhvcToLchabAllIntegerCase(hue40, scaledValue, halfChroma, dark = false) {
  // Handles the case HVC are all integer. If chroma is larger than 50, C*ab is
  // linearly extrapolated.

  // This function does no range checks: hue40 must be in {0, 1, ..., 39};
  // scaledValue must be in {0, 1, ..., 10} if dark is false, and {0, 1, ..., 6}
  // if dark is true; halfChroma must be a non-negative integer.
  if (dark) { // Value is in {0, 0.2, 0.4, 0.6, 0.8, 1}.
    if (halfChroma <= 25) {
      return [MRD.mrdLTableDark[scaledValue],
              MRD.mrdCHTableDark[hue40][scaledValue][halfChroma][0],
              MRD.mrdCHTableDark[hue40][scaledValue][halfChroma][1]];
    } else { // Linearly extrapolates a color outside the MRD.
      const cstarab = MRD.mrdCHTableDark[hue40][scaledValue][25][0];
      const factor = halfChroma/25;
      return [MRD.mrdLTableDark[scaledValue],
              cstarab * factor,
              MRD.mrdCHTableDark[hue40][scaledValue][25][1]];
    }
  } else {
    if (halfChroma <= 25) {
      return [MRD.mrdLTable[scaledValue],
              MRD.mrdCHTable[hue40][scaledValue][halfChroma][0],
              MRD.mrdCHTable[hue40][scaledValue][halfChroma][1]];
    } else {
      const cstarab = MRD.mrdCHTable[hue40][scaledValue][25][0];
      const factor = halfChroma/25;
      return [MRD.mrdLTable[scaledValue],
              cstarab * factor,
              MRD.mrdCHTable[hue40][scaledValue][25][1]];
    }
  }
}

// Handles the case V and C are integer.
function mhvcToLchabValueChromaIntegerCase(hue40, scaledValue, halfChroma, dark = false) {
  const hue1 = Math.floor(hue40);
  const hue2 = mod(Math.ceil(hue40), 40);
  const [lstar, cstarab1, hab1] = mhvcToLchabAllIntegerCase(hue1, scaledValue, halfChroma, dark);
  if (hue1 === hue2) {
    return [lstar, cstarab1, hab1];
  } else {
    const [ , cstarab2, hab2] = mhvcToLchabAllIntegerCase(hue2, scaledValue, halfChroma, dark);
    if ((hab1 === hab2) ||
        (mod(hab2 - hab1, 360) >= 180)) { // FIXME: was workaround for the rare
      // case hab1 exceeds hab2, which will be removed after some test.
      return [lstar, cstarab1, hab1];
    } else {
      const hab = circularLerp(hue40 - hue1, hab1, hab2, 360);
      const cstarab = (cstarab1 * mod(hab2 - hab, 360) / mod(hab2 - hab1, 360))
            + (cstarab2 * mod(hab - hab1, 360) / mod(hab2 - hab1, 360));
      return [lstar, cstarab, hab];
    }
  }
}

// Handles the case V is integer.
function mhvcToLchabValueIntegerCase(hue40, scaledValue, halfChroma, dark = false) {
  const halfChroma1 = Math.floor(halfChroma);
  const halfChroma2 = Math.ceil(halfChroma);
  if (halfChroma1 === halfChroma2) {
    return mhvcToLchabValueChromaIntegerCase(hue40, scaledValue, halfChroma, dark);
  } else {
    const [lstar, cstarab1, hab1] = mhvcToLchabValueChromaIntegerCase(hue40, scaledValue, halfChroma1, dark);
    const [, cstarab2, hab2] = mhvcToLchabValueChromaIntegerCase(hue40, scaledValue, halfChroma2, dark);
    const [astar1, bstar1] = polarToCartesian(cstarab1, hab1, 360);
    const [astar2, bstar2] = polarToCartesian(cstarab2, hab2, 360);
    const astar = astar1 * (halfChroma2 - halfChroma) + astar2 * (halfChroma - halfChroma1);
    const bstar = bstar1 * (halfChroma2 - halfChroma) + bstar2 * (halfChroma - halfChroma1);
    return labToLchab(lstar, astar, bstar);
  }
}

function mhvcToLchabGeneralCase(hue40, scaledValue, halfChroma, dark = false) {
  const actualValue = dark ? scaledValue*0.2 : scaledValue;
  const scaledValue1 = Math.floor(scaledValue);
  const scaledValue2 = Math.ceil(scaledValue);
  const lstar = munsellValueToL(actualValue);
  if (scaledValue1 === scaledValue2) {
    return mhvcToLchabValueIntegerCase(hue40, scaledValue1, halfChroma, dark);
  } else if (scaledValue1 === 0) {
    // If the given color is so dark (V < 0.2) that it is out of MRD, we use the
    // fact that the chroma and hue of LCHab corresponds roughly to that of
    // Munsell.
    const [, cstarab, hab] = mhvcToLchabValueIntegerCase(hue40, 1, halfChroma, dark);
    return [lstar, cstarab, hab];
  } else {
    const [lstar1, cstarab1, hab1] = mhvcToLchabValueIntegerCase(hue40, scaledValue1, halfChroma, dark);
    const [lstar2, cstarab2, hab2] = mhvcToLchabValueIntegerCase(hue40, scaledValue2, halfChroma, dark);
    const [astar1, bstar1] = polarToCartesian(cstarab1, hab1, 360);
    const [astar2, bstar2] = polarToCartesian(cstarab2, hab2, 360);
    const astar = astar1 * (lstar2 - lstar) / (lstar2 - lstar1) +
          astar2 * (lstar - lstar1) / (lstar2 - lstar1);
    const bstar = bstar1 * (lstar2 - lstar) / (lstar2 - lstar1) +
          bstar2 * (lstar - lstar1) / (lstar2 - lstar1);
    return labToLchab(lstar, astar, bstar);
  }
}

/**
 * Converts Munsell HVC to LCHab. Note that the returned value is under
 * <strong>Illuminant C</strong>.
 * @param {number} hue100 - is in the circle group R/100Z. Any real number is
 * accepted.
 * @param {number} value - will be in [0, 10]. Clamped if it exceeds the
 * interval.
 * @param {number} chroma - will be in [0, +inf). Assumed to be zero if it is
 * negative.
 * @returns {Array} [L*, C*ab, hab]
 */
export function mhvcToLchab(hue100, value, chroma) {
  const hue40 = mod(hue100 * 0.4, 40);
  const value10 = clamp(value, 0, 10);
  const halfChroma = Math.max(0, chroma) * 0.5;
  if (value >= 1) {
    return mhvcToLchabGeneralCase(hue40, value10, halfChroma, false);
  } else {
    return mhvcToLchabGeneralCase(hue40, value10 * 5, halfChroma, true);
  }
}

const hueNames = ["R", "YR", "Y", "GY", "G", "BG", "B", "PB", "P", "RP"];

/**
 * Converts Munsell Color string to Munsell HVC.
 * @param {string} munsellStr - is the standard Munsell Color code.
 * @returns {Array} [hue100, value, chroma]
 * @see munsell
 * @see mhvc
 */
export function munsellToMhvc(munsellStr) {
  const nums = munsellStr.split(/[^a-z0-9.\-]+/)
        .filter(Boolean)
        .map((str) => Number(str));
  const hueName = munsellStr.match(/[A-Z]+/)[0];
  const hueNumber = hueNames.indexOf(hueName);
  if (hueName === "N") {
    return [0, nums[0], 0];
  } else if (nums.length !== 3) {
    throw new SyntaxError(`Doesn't contain 3 numbers: ${nums}`);
  } else if (hueNumber === -1) { // achromatic
    throw new SyntaxError(`Invalid hue designator: ${hueName}`);
  } else {
    return [hueNumber * 10 + nums[0], nums[1], nums[2]];
  }
}

/**
 * Converts Munsell Color string to LCHab. Note that the returned value is under
 * <strong>Illuminant C</strong>.
 * @param {string} munsellStr - is the standard Munsell Color code.
 * @returns {Array} [L*, C*ab, hab]
 */
export function munsellToLchab(munsellStr) {
  return mhvcToLchab(...munsellToMhvc(munsellStr));
}

/** Converts Munsell HVC to CIELAB. Note that the returned value is under
 * <strong>Illuminant C</strong>.
 * @param {number} hue100 - is in the circle group R/100Z. Any real number is
 * accepted.
 * @param {number} value - will be in [0, 10]. Clamped if it exceeds the
 * interval.
 * @param {number} chroma - will be in [0, +inf). Assumed to be zero if it is
 * negative.
 * @returns {Array} [L*, a*, b*]
 */
export function mhvcToLab(hue100, value, chroma) {
  return lchabToLab(...mhvcToLchab(hue100, value, chroma));
}


/** Converts Munsell Color string to CIELAB. Note that the returned value is under
 * <strong>Illuminant C</strong>.
 * @param {string} munsellStr
 * @returns {Array} [L*, a*, b*]
 */
export function munsellToLab(munsellStr) {
  return mhvcToLab(...munsellToMhvc(munsellStr));
}

/** Converts Munsell HVC to XYZ.
 * @param {number} hue100 - is in the circle group R/100Z. Any real number is
 * accepted.
 * @param {number} value - will be in [0, 10]. Clamped if it exceeds the
 * interval.
 * @param {number} chroma - will be in [0, +inf). Assumed to be zero if it is
 * negative.
 * @param {illuminant} [illuminant = ILLUMINANT_D65]
 * @returns {Array} [X, Y, Z]
 */
export function mhvcToXyz(hue100, value, chroma, illuminant = ILLUMINANT_D65) {
  // Uses Bradford transformation
  return multMatrixVector(illuminant.catMatrixCToThis,
                          labToXyz(...mhvcToLab(hue100, value, chroma), ILLUMINANT_C));
}

/** Converts Munsell Color string to XYZ.
 * @param {string} munsellStr
 * @param {illuminant} [illuminant = ILLUMINANT_D65]
 * @returns {Array} [X, Y, Z]
 */
export function munsellToXyz(munsellStr, illuminant = ILLUMINANT_D65) {
  return mhvcToXyz(...munsellToMhvc(munsellStr), illuminant);
}

/** Converts Munsell HVC to linear RGB.
 * @param {number} hue100 - is in the circle group R/100Z. Any real
 * number is accepted.
 * @param {number} value - will be in [0, 10]. Clamped if it exceeds
 * the interval.
 * @param {number} chroma - will be in [0, +inf). Assumed to be zero
 * if it is negative.
 * @param {RGBSpace} [rgbSpace = SRGB]
 * @returns {Array} [linear R, linear G, linear B]
 */
export function mhvcToLinearRgb(hue100, value, chroma, rgbSpace = SRGB) {
  return xyzToLinearRgb(...mhvcToXyz(hue100, value, chroma, rgbSpace.illuminant), rgbSpace);
}

/** Converts Munsell Color string to linear RGB.
 * @param {string} munsellStr
 * @param {RGBSpace} [rgbSpace = SRGB]
 * @returns {Array} [linear R, linear G, linear B]
 */
export function munsellToLinearRgb(munsellStr, rgbSpace = SRGB) {
  return mhvcToLinearRgb(...munsellToMhvc(munsellStr), rgbSpace);
}

/** Converts Munsell HVC to gamma-corrected RGB.
 * @param {number} hue100 - is in the circle group R/100Z. Any real number is
 * accepted.
 * @param {number} value - will be in [0, 10]. Clamped if it exceeds the
 * interval.
 * @param {number} chroma - will be in [0, +inf). Assumed to be zero if it is
 * negative.
 * @param {RGBSpace} [rgbSpace = SRGB]
 * @returns {Array} [R, G, B]
 */
export function mhvcToRgb(hue100, value, chroma, rgbSpace = SRGB) {
  return linearRgbToRgb(...mhvcToLinearRgb(hue100, value, chroma, rgbSpace), rgbSpace);
}

/** Converts Munsell Color string to gamma-corrected RGB.
 * @param {string} munsellStr
 * @param {RGBSpace} [rgbSpace = SRGB]
 * @returns {Array} [R, G, B]
 */
export function munsellToRgb(munsellStr, rgbSpace = SRGB) {
  return mhvcToRgb(...munsellToMhvc(munsellStr), rgbSpace);
}

/** Concerts Munsell HVC to quantized RGB.
 * @param {number} hue100 - is in the circle group R/100Z. Any real number is
 * accepted.
 * @param {number} value - will be in [0, 10]. Clamped if it exceeds the
 * interval.
 * @param {number} chroma - will be in [0, +inf). Assumed to be zero if it is
 * negative.
 * @param {boolean} [clamp = true] - If true, the returned value will be clamped
 * to the range [0, 255].
 * @param {RGBSpace} [rgbSpace = SRGB]
 * @returns {Array} [R255, G255, B255]
 */
export function mhvcToRgb255(hue100, value, chroma, clamp = true, rgbSpace = SRGB) {
  return rgbToRgb255(... mhvcToRgb(hue100, value, chroma, rgbSpace), clamp);
}

/** Concerts Munsell Color string to quantized RGB.
 * @param {string} munsellStr
 * @param {boolean} [clamp = true] - If true, the returned value will be clamped
 * to the range [0, 255].
 * @param {RGBSpace} [rgbSpace = SRGB]
 * @returns {Array} [R255, G255, B255]
 */
export function munsellToRgb255(munsellStr, clamp = true, rgbSpace = SRGB) {
  return mhvcToRgb255(...munsellToMhvc(munsellStr), clamp, rgbSpace);
}

/**
 * Converts Munsell HVC to 24-bit hex color.
 * @param {number} hue100 - is in the circle group R/100Z. Any real number is
 * accepted.
 * @param {number} value - will be in [0, 10]. Clamped if it exceeds the
 * interval.
 * @param {number} chroma - will be in [0, +inf). Assumed to be zero if it is
 * negative.
 * @param {RGBSpace} [rgbSpace = SRGB]
 * @returns {string} hex color "#XXXXXX"
 */
export function mhvcToHex(hue100, value, chroma, rgbSpace = SRGB) {
  return rgbToHex(...mhvcToRgb(hue100, value, chroma, rgbSpace));
}

/**
 * Converts Munsell Color string to 24-bit hex color.
 * @param {string} munsellStr
 * @param {RGBSpace} [rgbSpace = SRGB]
 * @returns {string} hex color "#XXXXXX"
 */
export function munsellToHex(munsellStr, rgbSpace = SRGB) {
  return mhvcToHex(...munsellToMhvc(munsellStr), rgbSpace);
}

/**
 * Converts Munsell HVC to string. `N', the code for achromatic colors, is used
 * when the chroma becomes zero w.r.t. the specified number of digits.
 * @param {number} hue100
 * @param {number} value
 * @param {number} chroma
 * @param {number} [digits = 1] - is the number of digits after the decimal
 * point. Must be non-negative integer. Note that the units digit of the hue
 * prefix is assumed to be already after the decimal point.
 * @returns {string} Munsell Color code
 * @see mhvc
 * @see munsell
 */
export function mhvcToMunsell(hue100, value, chroma, digits = 1) {
  const canonicalHue100 = mod(hue100, 100);
  const huePrefix = canonicalHue100 % 10;
  const hueNumber = Math.round((canonicalHue100 - huePrefix)/10);
  // If the hue prefix is 0, 10 is instead used with the previous hue name.
  const hueStr = (huePrefix === 0) ?
        Number(10).toFixed(Math.max(digits-1, 0)) + hueNames[mod(hueNumber-1, 10)] :
        huePrefix.toFixed(Math.max(digits-1, 0)) + hueNames[hueNumber];
  const chromaStr = chroma.toFixed(digits);
  const valueStr = value.toFixed(digits);
  if (parseFloat(chromaStr) === 0) {
    return `N ${valueStr}`;
  } else {
    return `${hueStr} ${valueStr}/${chromaStr}`;
  }
}

