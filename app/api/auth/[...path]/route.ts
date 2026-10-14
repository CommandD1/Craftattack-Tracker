import { auth } from "@/lib/neonAuth";

export const { GET, POST, PUT, DELETE, PATCH } = auth.handler();
