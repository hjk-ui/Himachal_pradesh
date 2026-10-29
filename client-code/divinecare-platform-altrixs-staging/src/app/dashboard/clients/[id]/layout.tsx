import React from 'react';

/**
 * Safe client segment layout wrapper.
 * Access control and tenant boundary are enforced by /api/clients/[id] and page-level guards,
 * avoiding uncaught server-side layout exceptions.
 */
export default function ClientDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
