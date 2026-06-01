export async function beginTx(sql: any, fn: any): Promise<any> {
  return sql.begin(async (txSql: any) => {
    const unsafe = (sqlStr: string, params?: unknown[]) => {
      if (params && params.length > 0) {
        return txSql.unsafe(sqlStr, params);
      }
      return txSql.unsafe(sqlStr);
    };
    return fn({ unsafe });
  });
}
