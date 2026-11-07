# bend FnCtx-CHECK.bend - function-context rules on hand-written facts.
#   FC: fn 0 (file 0) ctx 1|8 async; fn 1 (file 0) ctx 2|8 Effect code; fn 2 (file 1) ctx 1;
#   fn 3 (file 1) ctx 8|32 interop callback; fn 4 (file 2) ctx 1|16 async in boundary.
#   CE: site 10 in fn 3 (ctx 8|32) -> fn 0; site 11 in fn 3 -> fn 4; site 12 in fn 1 (ctx 2|8) -> fn 0.
#   RE 5: all 8|32, none 4|16, tall 1, tnone 16 -> site 10 only (fn 4 is boundary, site 12 not interop).
#   RM 6: a = 2|8 none 52, b = 1|8 none 54 -> file 0 only (file 1 has no Effect code).
import Base
import ./Fanout.bend as F
import ./FnCtx.bend as N

def main() -> List<&2, String>:
  N.FnCtx.lines(N.NF{[F.Ce{10, 3, 0, 0, 0, 40}, F.Ce{11, 3, 4, 0, 0, 40}, F.Ce{12, 1, 0, 0, 0, 10}], [N.Fc{0, 0, 9}, N.Fc{1, 0, 10}, N.Fc{2, 1, 1}, N.Fc{3, 1, 40}, N.Fc{4, 2, 17}], [N.Re{5, 40, 20, 1, 16}], [N.Rm{6, 10, 52, 9, 54}]})
