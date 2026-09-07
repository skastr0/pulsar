export interface OrderLine {
  readonly sku: string
  readonly quantity: number
  readonly unitPriceCents: number
}

export function quoteOrder(lines: ReadonlyArray<OrderLine>): number {
  throw new Error("Not implemented")
}

export function handleQuote(request: Request): Promise<Response> {
  return request.json().then((lines: OrderLine[]) => {
    try {
      return Response.json({ totalCents: quoteOrder(lines) })
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 400 })
    }
  })
}
