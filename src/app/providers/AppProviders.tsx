import React from 'react';
import { RouterProvider } from '../router/RouterProvider';
import { ApplicationProvider } from './ApplicationProvider';
import { SessionProvider } from './SessionProvider';

export function AppProviders({ children }: { readonly children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ApplicationProvider>
        <RouterProvider>{children}</RouterProvider>
      </ApplicationProvider>
    </SessionProvider>
  );
}
