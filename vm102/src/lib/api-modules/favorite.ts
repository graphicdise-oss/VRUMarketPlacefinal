import { apiFetch } from "./core";
import { ProductDto } from "./product"; // Assuming ProductDto is exported here, if not, we can use any or define it.

export const favoriteApi = {
  list: () => apiFetch<ProductDto[]>("/favorites", { cache: "no-store" }),
  add: (productId: string) => apiFetch(`/favorites/products/${productId}`, { method: "POST" }),
  remove: (productId: string) => apiFetch(`/favorites/products/${productId}`, { method: "DELETE" }),
};
