import {polarToCartesian,
        cartesianToPolar,
        multMatrixVector,
        clamp} from './arithmetic.js';

const CONST1 = 216/24389;
const CONST2 = 24389/27/116;
const CONST3 = 16/116;

export function functionF(x) {
  // Called in XYZ -> Lab conversion
  if (x > CONST1) {
    return Math.pow(x, 0.3333333333333333);
  } else {
    return CONST2 * x + CONST3;
  }
}

export function labToLchab(lstar, astar, bstar) {
  return [lstar, ...cartesianToPolar(astar, bstar, 360)];
}

export function lchabToLab(lstar, Cstarab, hab) {
  return [lstar, ...polarToCartesian(Cstarab, hab, 360)];
}


class Illuminant {
  constructor(X, Z, catMatrixCToThis, catMatrixThisToC) {
    this.X = X;
    this.Z = Z;
    this.catMatrixCToThis = catMatrixCToThis;
    this.catMatrixThisToC = catMatrixThisToC;
  }
}

// The following data are based on dufy. CAT is Bradford transformation.
/** @type {Illuminant} */
export const ILLUMINANT_D65 =
  new Illuminant(0.950428061568676,
                 1.08891545904089,
                 [[0.9904112147597705,-0.00718628493839008,-0.011587161829988951],
                  [-0.012395677058354078,1.01560663662526,-0.0029181533414322086],
                  [-0.003558889496942143,0.006762494889396557,0.9182865019746504]],
                 [[1.0098158523233767,0.007060316533713093,0.012764537821734395],
                  [0.012335983421444891,0.9846986027789835,0.003284857773421468],
                  [0.003822773174044815,-0.007224207660971385,1.0890100329203007]]);
/** @type {Illuminant} */
export const ILLUMINANT_C =
  new Illuminant(0.9807171421603395,
                 1.182248923134197,
                 [[1,0,0],[0,1,0],[0,0,1]],
                 [[1,0,0],[0,1,0],[0,0,1]]);

const DELTA = 6/29;
const CONST4 = 3*DELTA*DELTA;

export function lToY(lstar) {
  const fy = (lstar + 16) / 116;
  return (fy > DELTA) ? (fy*fy*fy) : ((fy - CONST3) * CONST4);
}

export function labToXyz(lstar, astar, bstar, illuminant = ILLUMINANT_D65) {
  const fy = (lstar + 16) / 116;
  const fx = fy + astar * 0.002;
  const fz = fy - bstar * 0.005;
  const Xw = illuminant.X;
  const Zw = illuminant.Z;
  return [ (fx > DELTA) ? (fx*fx*fx*Xw) : ((fx - CONST3) * CONST4 * Xw),
           (fy > DELTA) ? (fy*fy*fy) : ((fy - CONST3) * CONST4),
           (fz > DELTA) ? (fz*fz*fz*Zw) : ((fz - CONST3) * CONST4 * Zw) ];  
}

export function xyzToLab(X, Y, Z, illuminant = ILLUMINANT_D65) {
  const [fX, fY, fZ] = [X / illuminant.X, Y, Z / illuminant.Z].map(functionF);
  return [116 * fY - 16,
          500 * (fX - fY),
          200 * (fY - fZ)];
}

function genLinearizer(gamma) {
  // Returns a function for gamma-correction (not for sRGB).
  const reciprocal = 1/gamma;
  return (x) => {
    return x >= 0 ? Math.pow(x, reciprocal) : -Math.pow(-x, reciprocal);
  };
}

function genDelinearizer(gamma) {
  // Returns a function for linearization (not for sRGB).
  return (x) => {
    return x >= 0 ? Math.pow(x, gamma) : -Math.pow(-x, gamma);
  };
}

class RGBSpace {
  constructor(matrixThisToXyz, matrixXyzToThis,
              linearizer = genLinearizer(2.2), delinearizer = genDelinearizer(2.2),
              illuminant = ILLUMINANT_D65) {
    this.matrixThisToXyz = matrixThisToXyz;
    this.matrixXyzToThis = matrixXyzToThis;
    this.linearizer = linearizer;
    this.delinearizer = delinearizer;
    this.illuminant = illuminant;
  }
}

const CONST5 = 0.0031308*12.92;

// The following data are based on dufy.
/** @type {RGBSpace} */
export const SRGB = new RGBSpace(
  [[0.4124319639872968,0.3575780371782625,0.1804592355313134],
   [0.21266023143094992,0.715156074356525,0.07218369421252536],
   [0.01933274831190452,0.11919267905942081,0.9504186404649174]],
  [[3.240646461582504,-1.537229731776316,-0.49856099408961585],
   [-0.969260718909152,1.876000564872059,0.04155578980259398],
   [0.05563672378977863,-0.2040013205625215,1.0570977520057931]],
  (x) => { // Below is actually the linearizer of bg-sRGB.
    if (x > CONST5) {
      return Math.pow ((0.055 + x) / 1.055, 2.4);
    } else if (x < -CONST5) {
      return - Math.pow ((0.055 - x) / 1.055, 2.4);
    } else {
      return x / 12.92;
    }
  },
  (x) => { // Below is actually the delinearizer of bg-sRGB.
    if (x > 0.0031308) {
      return Math.pow(x, 1/2.4) * 1.055 - 0.055;
    } else if (x < -0.0031308) {
      return - Math.pow(-x, 1/2.4) * 1.055 + 0.055;
    } else {
      return x * 12.92;
    }
  }
);

/** 
 * @type {RGBSpace}
 */
export const ADOBE_RGB = new RGBSpace (
  [[0.5766645233146432, 0.18556215235063508, 0.18820138590339738],
   [0.29734264483411293, 0.6273768008045281, 0.07528055436135896],
   [0.027031149530373878, 0.07069034375262295, 0.991193965757893]],
  [[2.0416039047109305,-0.5650114025085637,-0.3447340526026908],
   [-0.969223190031607,1.8759279278672774,0.04155418080089159],
   [0.01344622799042258,-0.11837953662156253,1.015322039041507]],
  genDelinearizer(563/256),
  genLinearizer(563/256)
);

export function xyzToLinearRgb(X, Y, Z, rgbSpace = SRGB) {
  return multMatrixVector(rgbSpace.matrixXyzToThis, [X, Y, Z]);
}

export function linearRgbToXyz(lr, lg, lb, rgbSpace = SRGB) {
  return multMatrixVector(rgbSpace.matrixThisToXyz, [lr, lg, lb]);
}

export function linearRgbToRgb(lr, lg, lb, rgbSpace = SRGB) {
  return [lr, lg, lb].map(rgbSpace.delinearizer);
}

export function rgbToLinearRgb(r, g, b, rgbSpace = SRGB) {
  return [r, g, b].map(rgbSpace.linearizer);
}


export function rgbToRgb255(r, g, b, clamp = true) {
  if (clamp) {
    return [r, g, b].map((x) => Math.max(Math.min(Math.round(x * 255), 255), 0));
  } else {
    return [r, g, b].map((x) => Math.round(x * 255));
  }
}

export function rgb255ToRgb(r255, g255, b255) {
  return [r255 / 255, g255 / 255, b255 /255];
}

export function rgbToHex(r, g, b) {
  return "#".concat([r, g, b]
                    .map((x) => {
                      const hex = clamp(Math.round(x * 255), 0, 255).toString(16);
                      return hex.length === 1 ? `0${hex}` : hex;
                    })
                    .join(""));
}

export function hexToRgb(hex) {
  const num = parseInt(hex.slice(1), 16);
  const length = hex.length;
  switch (length) {
  case 7: // #XXXXXX
    return [num >> 16, num >> 8, num].map((x) => (x & 0xff) / 255);
  case 4: // #XXX
    return [num >> 8, num >> 4, num].map((x) => (x & 0xf) / 15);
  case 9: // #XXXXXXXX
    return [num >> 24, num >> 16, num >> 8].map((x) => (x & 0xff) / 255);
  case 5: // #XXXX
    return [num >> 12, num >> 8, num >> 4].map((x) => (x & 0xf) / 15);
  default:
    throw SyntaxError(`The length of hex color is invalid: ${hex}`);
  }
}
