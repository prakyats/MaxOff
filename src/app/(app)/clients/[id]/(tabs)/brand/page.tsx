import type { Metadata } from "next";

import { Card, CardContent } from "@/core/ui/primitives/card";
import { getBrand } from "@/modules/clients";
import { BrandRecord, ClientLogoEditor } from "@/modules/clients/components/brand-record";
import { ClientLogo } from "@/modules/clients/components/client-logo";

import { loadClient } from "../../client";

export const metadata: Metadata = { title: "Brand" };

/**
 * A client's light brand kit (3.4, PRODUCT §4.4): the logo (the list shows it) with its upload
 * sheet, then colours, fonts, tone of voice and brand notes through the edit pattern.
 */
export default async function ClientBrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { client, canEdit } = await loadClient(id);
  const brand = (await getBrand(client.id)) ?? {
    clientId: client.id,
    logoFileId: null,
    colors: [],
    fonts: [],
    toneOfVoice: null,
    brandNotes: null,
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4" data-slot="client-brand">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <ClientLogo fileId={brand.logoFileId} name={client.name} size="lg" />
            <div className="min-w-0 text-sm">
              <p className="font-medium">Logo</p>
              <p className="text-muted-foreground">
                {brand.logoFileId ? "Shown in client lists." : "No logo yet."}
              </p>
            </div>
          </div>
          {canEdit ? (
            <ClientLogoEditor
              clientId={client.id}
              clientName={client.name}
              hasLogo={brand.logoFileId !== null}
            />
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <BrandRecord
            clientId={client.id}
            clientName={client.name}
            brand={brand}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
