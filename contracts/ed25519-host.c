// NEAR's native Ed25519 verifier, exposed to SDK 2's older QuickJS bridge.
// ABI: near/near-sdk-rs/near-sys/src/lib.rs::ed25519_verify.
extern uint64_t ed25519_verify(uint64_t sig_len, uint64_t sig_ptr,
  uint64_t msg_len, uint64_t msg_ptr, uint64_t key_len, uint64_t key_ptr);
static JSValue near_ed25519_verify(JSContext *ctx, JSValueConst this_val,
  int argc, JSValueConst *argv) {
  if (argc != 3) return JS_ThrowTypeError(ctx, "Expected signature, message, public key");
  size_t sig_len, msg_len, key_len;
  uint8_t *sig = JS_Uint8Array_to_C(ctx, argv[0], &sig_len);
  uint8_t *msg = JS_Uint8Array_to_C(ctx, argv[1], &msg_len);
  uint8_t *key = JS_Uint8Array_to_C(ctx, argv[2], &key_len);
  if (sig == NULL || msg == NULL || key == NULL)
    return JS_ThrowTypeError(ctx, "Expected Uint8Array arguments");
  if (sig_len != 64 || key_len != 32) return JS_NewBool(ctx, 0);
  return JS_NewBool(ctx, ed25519_verify(sig_len, (uint64_t)sig,
    msg_len, (uint64_t)msg, key_len, (uint64_t)key) == 1);
}
