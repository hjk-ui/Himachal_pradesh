import { NextResponse } from 'next/server';

export async function GET() {
  const packageName = process.env.ANDROID_PACKAGE_NAME?.trim() || 'com.altrixs.patient';
  const fingerprintsRaw = process.env.ANDROID_SHA256_FINGERPRINTS?.trim();
  const certFingerprints = fingerprintsRaw
    ? fingerprintsRaw.split(',').map((f) => f.trim()).filter(Boolean)
    : ['14:6D:E9:7C:0F:86:EC:30:EC:F2:EC:75:A2:8E:6C:C1:DF:04:7E:89:B6:9F:F6:B5:2C:6B:65:64:AC:4F:33:44'];

  const assetLinks = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: certFingerprints,
      },
    },
  ];

  return NextResponse.json(assetLinks, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
