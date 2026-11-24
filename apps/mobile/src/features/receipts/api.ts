/** Photos des tickets : dépôt dans l'espace privé de la Team et lecture par URL signée. */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Décode du base64 en octets (atob existe sur Hermes et sur le web). */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomName(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Dépose la photo dans le dossier de la Team et renvoie son chemin. */
export async function uploadReceipt(teamId: string, base64: string, mime: string): Promise<string> {
  const ext = EXTENSIONS[mime] ?? "jpg";
  const path = `${teamId}/${randomName()}.${ext}`;
  const { error } = await supabase.storage
    .from("receipts")
    .upload(path, base64ToBytes(base64), { contentType: mime, upsert: false });
  if (error) throw error;
  return path;
}

/** Enregistre le ticket (photo + texte lu) et renvoie son identifiant. */
export async function createReceipt(
  teamId: string,
  path: string,
  ocrText: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("create_receipt", {
    p_team: teamId,
    p_path: path,
    p_ocr_text: ocrText.slice(0, 20000),
  });
  if (error) throw error;
  return data as string;
}

/** Adresse temporaire (1 h) de la photo d'un ticket rattaché à une dépense. */
export function useReceiptUrl(receiptId: string | null) {
  return useQuery({
    queryKey: ["receipt-url", receiptId],
    enabled: receiptId !== null,
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<string | null> => {
      const { data: receipt, error } = await supabase
        .from("receipts")
        .select("storage_path")
        .eq("id", receiptId as string)
        .maybeSingle();
      if (error) throw error;
      if (!receipt) return null;
      const { data, error: signError } = await supabase.storage
        .from("receipts")
        .createSignedUrl(receipt.storage_path as string, 3600);
      if (signError) throw signError;
      return data.signedUrl;
    },
  });
}
