// URL dùng chung cho kiểm thử trình duyệt; không thuộc bundle ứng dụng.
export const sourceModules = {
  "wristBoundaryMeasurement": "/src/features/bracelet/services/measurement/wristBoundaryMeasurement.ts",
  "wristGeometry": "/tests/browser/support/wristGeometry.ts",
  "braceletSizing": "/tests/browser/support/braceletSizing.ts",
  "braceletRenderer": "/src/features/bracelet/views/rendering/braceletRenderer.ts",
  "braceletRenderFrame": "/src/features/bracelet/models/braceletRenderFrame.ts",
  "braceletDimensions": "/src/features/bracelet/models/braceletDimensions.ts",
  "braceletModel": "/src/features/bracelet/views/rendering/braceletModel.ts",
  "imageOcclusion": "/src/features/bracelet/views/rendering/imageOcclusion.ts",
  "imageWristMeasurement": "/src/features/bracelet/services/measurement/imageWristMeasurement.ts",
  "imageWristRegistration": "/src/features/bracelet/services/fitting/imageWristRegistration.ts",
  "segmentedWristMeasurement": "/src/features/bracelet/services/measurement/segmentedWristMeasurement.ts",
  "wristDebug": "/src/features/bracelet/views/debug/wristDebug.ts",
  "liveWristTracking": "/src/features/bracelet/services/live/liveWristTracking.ts",
  "wristRoiTracking": "/src/features/bracelet/services/tracking/wristRoiTracking.ts",
  "testing/wristFixtures": "/src/features/bracelet/tests/fixtures/wristFixtures.ts",
  "testing/renderScenarios": "/src/features/bracelet/tests/fixtures/renderScenarios.ts"
};
export const sourceInitScript = 'window.miraSourceModules = ' + JSON.stringify(sourceModules) + ';';
