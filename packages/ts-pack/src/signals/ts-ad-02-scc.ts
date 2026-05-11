import { tarjanSccs } from "../graph/tarjan.js"

export const stronglyConnectedComponents = (
  graph: ReadonlyMap<string, ReadonlySet<string>>,
): Array<Array<string>> => {
  return tarjanSccs(graph).map((component) => [...component])
}
