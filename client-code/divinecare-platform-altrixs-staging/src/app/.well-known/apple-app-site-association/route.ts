import { NextResponse } from 'next/server';

export async function GET() {
  const appID = process.env.APPLE_APP_ID?.trim() || 'TEAMID1234.com.altrixs.patient';

  const aasa = {
    applinks: {
      apps: [],
      details: [
        {
          appID,
          paths: ['/patient/accept*', '/patient/*'],
        },
      ],
    },
    webcredentials: {
      apps: [appID],
    },
  };

  return NextResponse.json(aasa, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
