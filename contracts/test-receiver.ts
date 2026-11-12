import { NearBindgen, call } from "near-sdk-js";
@NearBindgen({})
class Receiver {
  @call({})
  nft_on_transfer({ msg }: { msg: string }) {
    return msg === "return";
  }
}
