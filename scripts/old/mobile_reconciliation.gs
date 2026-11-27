const MOBILE_RECONCILIATION_CONFIG = {
  DATE_WINDOW_DAYS: 5,
  VALUE_TOLERANCE: 5,
  ACCOUNT_OWNER_NAME: "CLAYTON EDUARDO DE OLIVEIRA",
  ALIAS_SHEET: "_mobile_merchant_aliases",
  ALIAS_HEADERS: [
    "ESTABELECIMENTO",
    "TIPO_ORIGEM",
    "ORIGEM",
    "CONFIRMADO_EM"
  ]
};


function executarComLockMobile_(
  callback
) {

  const lock =
    LockService.getScriptLock();

  lock.waitLock(30000);

  try {
    return callback();
  } finally {
    lock.releaseLock();
  }

}


function getCompromissosMobile_(
  incluirFinalizados
) {

  const tabela =
    obterTabelaNomeada_(
      CONFIG_MOVIMENTACAO.INTERVALO_COMPROMISSOS
    );

  const colunaData =
    obterIndiceColuna_(
      tabela,
      CONFIG_MOVIMENTACAO.COLUNAS_COMPROMISSOS.VENCIMENTO
    );

  const colunaDescricao =
    obterIndiceColuna_(
      tabela,
      CONFIG_MOVIMENTACAO.COLUNAS_COMPROMISSOS.DESCRICAO
    );

  const colunaTipo =
    obterIndiceColuna_(
      tabela,
      CONFIG_MOVIMENTACAO.COLUNAS_COMPROMISSOS.TIPO
    );

  const colunaValor =
    obterIndiceColuna_(
      tabela,
      CONFIG_MOVIMENTACAO.COLUNAS_COMPROMISSOS.VALOR
    );

  const colunaStatusInterno =
    obterIndiceColuna_(
      tabela,
      CONFIG_MOVIMENTACAO.COLUNAS_COMPROMISSOS.STATUS_INTERNO
    );

  const colunaStatus =
    obterIndiceColuna_(
      tabela,
      CONFIG_MOVIMENTACAO.COLUNAS_COMPROMISSOS.STATUS
    );

  if (
    tabela.quantidadeLinhas <= 1
  ) {
    return [];
  }

  const dados =
    tabela.intervalo
      .offset(
        1,
        0,
        tabela.quantidadeLinhas - 1,
        tabela.quantidadeColunas
      )
      .getValues();

  const exibidos =
    tabela.intervalo
      .offset(
        1,
        0,
        tabela.quantidadeLinhas - 1,
        tabela.quantidadeColunas
      )
      .getDisplayValues();

  const compromissos = [];


  for (
    let indice = 0;
    indice < dados.length;
    indice++
  ) {

    const linha =
      dados[indice];

    const linhaExibida =
      exibidos[indice];

    const data =
      normalizarDataMobile_(
        linha[colunaData]
      );

    const descricao =
      limparTextoMobile_(
        linhaExibida[colunaDescricao]
      );

    const tipoOriginal =
      limparTextoMobile_(
        linhaExibida[colunaTipo]
      );

    const valor =
      normalizarNumeroMobile_(
        linha[colunaValor]
      );

    const status =
      limparTextoMobile_(
        linhaExibida[colunaStatus]
      );

    const statusInterno =
      limparTextoMobile_(
        linhaExibida[colunaStatusInterno]
      );

    if (
      !data ||
      !descricao ||
      !tipoOriginal ||
      valor === null
    ) {
      continue;
    }

    if (
      normalizeText_(tipoOriginal) ===
      normalizeText_("Benefício")
    ) {
      continue;
    }

    const finalizado =
      compromissoMobileFinalizado_(
        status,
        statusInterno
      );

    if (
      finalizado &&
      !incluirFinalizados
    ) {
      continue;
    }

    const tipoOrigem =
      normalizarTipoOrigemMobile_(
        tipoOriginal
      );

    const origem =
      getOrigemConciliacao_(
        tipoOrigem,
        descricao
      );

    const referencia =
      obterReferenciaDaData_(
        data
      );

    compromissos.push({
      id:
        criarIdCompromissoMobile_(
          referencia,
          tipoOrigem,
          origem
        ),

      sourceRow:
        tabela.linhaInicial + 1 + indice,

      data:
        data,

      dataTexto:
        formatarDataIsoMobile_(
          data
        ),

      referencia:
        referencia,

      tipo:
        tipoOrigem,

      origem:
        origem,

      descricao:
        descricao,

      valor:
        valor,

      status:
        status,

      statusInterno:
        statusInterno,

      finalizado:
        finalizado
    });

  }


  return compromissos;

}


function criarIdCompromissoMobile_(
  referencia,
  tipoOrigem,
  origem
) {

  const chave = [
    normalizarReferencia_(
      referencia
    ),
    normalizeText_(
      tipoOrigem
    ),
    normalizeText_(
      origem
    )
  ].join("|");

  return Utilities
    .base64EncodeWebSafe(
      chave
    );

}


function normalizarTipoOrigemMobile_(
  tipo
) {

  if (
    normalizeText_(tipo)
      .indexOf("RENDA") === 0
  ) {
    return "Rendas";
  }

  return getTipoOrigemConciliacao_(
    tipo
  );

}

function normalizarEventoMobile_(
  valor
) {

  const evento =
    normalizeText_(
      valor
    )
    .replace(/[\s-]+/g, "_");

  if (
    evento === "IGNORAR" ||
    evento === "IGNORE" ||
    evento === "NOTIFICACAO_IRRELEVANTE" ||
    evento === "NAO_TRANSACAO"
  ) {
    return "IGNORAR";
  }

  if (
    evento === "COMPRA_CANCELADA" ||
    evento === "CANCELAMENTO_COMPRA" ||
    evento === "CANCELADA"
  ) {
    return "COMPRA_CANCELADA";
  }

  if (
    evento === "ESTORNO" ||
    evento === "REEMBOLSO"
  ) {
    return "ESTORNO";
  }

  return "COMPRA";

}


function normalizarIdCompromissoMobile_(
  valor
) {

  const texto =
    limparTextoMobile_(
      valor
    );

  if (
    !texto ||
    normalizeText_(texto) === "NULL"
  ) {
    return "";
  }

  return texto;

}


function compromissoMobileFinalizado_(
  status,
  statusInterno
) {

  const texto =
    normalizeText_(
      [
        status,
        statusInterno
      ].join(" ")
    )
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

  const palavras =
    texto
      ? texto.split(/\s+/)
      : [];

  return (
    palavras.indexOf("CANCELADO") >= 0 ||
    palavras.indexOf("CANCELADA") >= 0 ||
    (
      palavras.indexOf("PAGO") >= 0 &&
      palavras.indexOf("NAO") < 0
    )
  );

}


function getCompromissosContextoMobile_() {

  return getCompromissosMobile_(
    false
  ).map(compromisso => ({

    id:
      compromisso.id,

    data:
      compromisso.dataTexto,

    tipo:
      compromisso.tipo,

    origem:
      compromisso.origem,

    descricao:
      compromisso.descricao,

    valor:
      compromisso.valor,

    status:
      compromisso.status

  }));

}


function processarConciliacaoCompromissoMobile_(
  dados,
  origem,
  request
) {

  const todos =
    getCompromissosMobile_(
      true
    );

  const candidatos =
    todos.filter(compromisso =>
      compromissoDentroDaJanelaMobile_(
        compromisso,
        dados
      )
    );

  const idSelecionado =
    limparTextoMobile_(
      dados.compromissoId
    );

  const candidatosAtivos =
    candidatos.filter(compromisso =>
      !compromisso.finalizado
    );

  const candidatosPorEstabelecimento =
    candidatosAtivos.filter(compromisso =>
      mobileEstabelecimentoCorresponde_(
        dados.estabelecimento ||
          dados.descricao,
        compromisso.descricao
      )
    );

  const candidatosJaConciliados =
    candidatos.filter(compromisso => {

      if (!compromisso.finalizado) {
        return false;
      }

      const movimentacao =
        localizarMovimentacao_({
          referencia:
            compromisso.referencia,

          tipoOrigem:
            compromisso.tipo,

          origem:
            compromisso.origem
        });

      return Boolean(
        movimentacao &&
        movimentacao.conciliado
      );

    });

  if (
    !idSelecionado &&
    candidatosAtivos.length === 0 &&
    candidatos.length === 1 &&
    candidatosJaConciliados.length === 1
  ) {
    const compromisso =
      candidatosJaConciliados[0];

    const descontosFolhaPagos =
      compromisso.tipo === "Rendas" &&
      dados.tipoMovimento === "ENTRADA"
        ? conciliarDescontosFolhaDaRenda_(
            compromisso,
            todos,
            dados.data,
            dados.conta,
            origem
          )
        : 0;

    const movimentacao =
      localizarMovimentacao_({
        referencia:
          compromisso.referencia,

        tipoOrigem:
          compromisso.tipo,

        origem:
          compromisso.origem
      });

    return {
      handled: true,
      ok: true,
      status: "DUPLICADO",
      tipo: "CONCILIACAO",
      destino: "Movimentações",
      linha: movimentacao.linha,
      duplicado: true,
      descontosFolhaPagos:
        descontosFolhaPagos,
      mensagem:
        descontosFolhaPagos > 0
          ? `Movimentação já conciliada; ${descontosFolhaPagos} desconto(s) em folha marcado(s) como pago(s).`
          : "Movimentação já conciliada."
    };
  }

  if (
    !idSelecionado &&
    candidatos.length > 0 &&
    candidatosAtivos.length === 0
  ) {
    return criarRevisaoMobile_(
      request,
      dados,
      origem,
      "compromisso_finalizado_sem_conciliacao",
      "Há um compromisso próximo já finalizado, mas sem conciliação correspondente."
    );
  }


  let selecionados = [];

  if (idSelecionado) {
    selecionados =
      candidatos.filter(compromisso =>
        compromisso.id === idSelecionado
      );
  } else {
    selecionados =
      candidatosPorEstabelecimento;

    if (
      selecionados.length === 0 &&
      candidatos.length === 1 &&
      candidatosAtivos.length === 1
    ) {
      selecionados =
        candidatosAtivos;
    }

    if (
      candidatos.length > 1 &&
      selecionados.length !== 1
    ) {
      return criarRevisaoMobile_(
        request,
        dados,
        origem,
        "compromisso_ambiguo",
        "Mais de um compromisso corresponde a data/valor e não foi possível confirmar o estabelecimento."
      );
    }

    if (
      selecionados.length === 0
    ) {
      return null;
    }
  }


  if (
    idSelecionado &&
    selecionados.length === 0
  ) {
    return criarRevisaoMobile_(
      request,
      dados,
      origem,
      "compromisso_indisponivel_ou_fora_da_tolerancia",
      "O compromisso selecionado não está mais disponível ou está fora da tolerância de data/valor."
    );
  }


  if (
    !idSelecionado &&
    selecionados.length === 0
  ) {
    return null;
  }


  if (
    selecionados.length > 1
  ) {
    return criarRevisaoMobile_(
      request,
      dados,
      origem,
      "compromisso_ambiguo",
      "Mais de um compromisso corresponde aos dados da transação."
    );
  }


  const compromisso =
    selecionados[0];

  const tabelaMovimentacoes =
    obterTabelaNomeada_(
      CONFIG_MOVIMENTACAO.INTERVALO_MOVIMENTACOES
    );

  const filtro = {
    referencia:
      compromisso.referencia,

    tipoOrigem:
      compromisso.tipo,

    origem:
      compromisso.origem
  };

  const movimentacao =
    localizarMovimentacao_(
      filtro,
      tabelaMovimentacoes
    );


  if (
    compromisso.finalizado &&
    movimentacao &&
    movimentacao.conciliado
  ) {
    const descontosFolhaPagos =
      compromisso.tipo === "Rendas" &&
      dados.tipoMovimento === "ENTRADA"
        ? conciliarDescontosFolhaDaRenda_(
            compromisso,
            todos,
            dados.data,
            dados.conta,
            origem
          )
        : 0;

    return {
      handled: true,
      ok: true,
      status: "DUPLICADO",
      tipo: "CONCILIACAO",
      destino: "Movimentações",
      linha: movimentacao.linha,
      duplicado: true,
      descontosFolhaPagos:
        descontosFolhaPagos,
      mensagem:
        descontosFolhaPagos > 0
          ? `Movimentação já conciliada; ${descontosFolhaPagos} desconto(s) em folha marcado(s) como pago(s).`
          : "Movimentação já conciliada."
    };
  }

  if (
    compromisso.finalizado
  ) {
    return criarRevisaoMobile_(
      request,
      dados,
      origem,
      "compromisso_ja_finalizado",
      "O compromisso selecionado já está finalizado e não possui uma conciliação correspondente."
    );
  }


  const observacao =
    criarNotaConciliacaoMobile_(
      origem,
      request,
      movimentacao
    );

  const resultado =
    savePaymentRecord({

      sourceRow:
        compromisso.sourceRow,

      targetRow:
        movimentacao
          ? movimentacao.linha
          : null,

      date:
        formatarDataParaFormulario_(
          dados.data
        ),

      value:
        Math.abs(
          dados.valor
        ),

      reference:
        compromisso.referencia,

      account:
        dados.conta,

      paymentFunction:
        obterFuncaoConciliacaoMobile_(
          dados,
          request,
          compromisso
        ),

      originType:
        compromisso.tipo,

      origin:
        compromisso.origem,

      reconciled:
        true,

      notes:
        observacao

    });


  if (
    !resultado ||
    resultado.success !== true
  ) {
    throw new Error(
      resultado &&
      resultado.message
        ? resultado.message
        : "Não foi possível conciliar a movimentação."
    );
  }

  const descontosFolhaPagos =
    compromisso.tipo === "Rendas" &&
    dados.tipoMovimento === "ENTRADA"
      ? conciliarDescontosFolhaDaRenda_(
          compromisso,
          todos,
          dados.data,
          dados.conta,
          origem
        )
      : 0;


  if (
    request &&
    toBoolean_(
      request.confirmar_apelido
    ) &&
    dados.estabelecimento
  ) {
    registrarApelidoEstabelecimentoMobile_(
      dados.estabelecimento,
      compromisso.tipo,
      compromisso.origem
    );
  }


  return {
    handled: true,
    ok: true,
    status: resultado.mode === "updated"
      ? "CONCILIADO_ATUALIZADO"
      : "CONCILIADO",
    tipo: "CONCILIACAO",
    destino: "Movimentações",
    linha: resultado.row,
    duplicado: false,
    descontosFolhaPagos:
      descontosFolhaPagos,
    mensagem:
      descontosFolhaPagos > 0
        ? `Renda conciliada; ${descontosFolhaPagos} desconto(s) em folha marcado(s) como pago(s).`
        : "Compromisso conciliado."
  };

}


function obterFuncaoConciliacaoMobile_(
  dados,
  request,
  compromisso
) {
  const contexto =
    normalizeText_(
      [
        dados && dados.descricao,
        dados && dados.estabelecimento,
        request &&
          (
            request.texto_base ||
            request.texto_original ||
            request.raw_text ||
            request.text
          )
      ]
      .filter(Boolean)
      .join(" ")
    );

  if (
    compromisso &&
    compromisso.tipo === "Rendas" &&
    dados &&
    dados.tipoMovimento === "ENTRADA" &&
    /\bTED\b/.test(contexto)
  ) {
    return "Crédito";
  }

  return dados && dados.funcao
    ? dados.funcao
    : "";
}


function compromissoDentroDaJanelaMobile_(
  compromisso,
  dados
) {

  if (
    !compromisso ||
    !dados ||
    !dados.data ||
    dados.valor === null ||
    !Number.isFinite(
      Number(dados.valor)
    )
  ) {
    return false;
  }

  if (
    !compromisso.finalizado &&
    !tipoCompromissoCompativelMobile_(
      compromisso.tipo,
      dados.tipoMovimento
    )
  ) {
    return false;
  }

  const diferencaDias =
    Math.abs(
      diferencaDiasMobile_(
        compromisso.data,
        dados.data
      )
    );

  const diferencaValor =
    Math.abs(
      Math.abs(
        Number(compromisso.valor)
      ) -
      Math.abs(
        Number(dados.valor)
      )
    );

  return (
    diferencaDias <=
      MOBILE_RECONCILIATION_CONFIG.DATE_WINDOW_DAYS &&
    diferencaValor <=
      MOBILE_RECONCILIATION_CONFIG.VALUE_TOLERANCE
  );

}


function tipoCompromissoCompativelMobile_(
  tipo,
  tipoMovimento
) {

  const tipoNormalizado =
    normalizeText_(
      tipo
    );

  const movimentoNormalizado =
    normalizeText_(
      tipoMovimento
    );

  const ehRenda =
    tipoNormalizado.indexOf(
      "RENDA"
    ) === 0;

  if (
    movimentoNormalizado === "ENTRADA"
  ) {
    return ehRenda;
  }

  if (
    movimentoNormalizado === "SAIDA" ||
    movimentoNormalizado === "SAÍDA"
  ) {
    return !ehRenda;
  }

  return false;

}


function diferencaDiasMobile_(
  primeiraData,
  segundaData
) {

  const primeira =
    new Date(
      primeiraData.getFullYear(),
      primeiraData.getMonth(),
      primeiraData.getDate()
    );

  const segunda =
    new Date(
      segundaData.getFullYear(),
      segundaData.getMonth(),
      segundaData.getDate()
    );

  return Math.round(
    (
      segunda.getTime() -
      primeira.getTime()
    ) / 86400000
  );

}


function criarNotaConciliacaoMobile_(
  origem,
  request,
  movimentacao
) {

  const notaExistente =
    movimentacao &&
    movimentacao.notas
      ? movimentacao.notas
      : "";

  const identificador =
    request &&
    (
      request.id_transacao ||
      request.transaction_id ||
      request.email_id
    );

  const novaNota =
    "Conciliação mobile (" +
    origem +
    ")" +
    (
      identificador
        ? " ID: " + identificador
        : ""
    );

  return [
    notaExistente,
    novaNota
  ]
    .filter(Boolean)
    .join(" | ");

}


function criarRevisaoMobile_(
  request,
  dados,
  origem,
  pendencia,
  mensagem
) {

  const id =
    registrarEntradaPendenteMobile_(
      request,
      request,
      dados,
      dados.conta,
      [pendencia],
      origem,
      ""
    );

  return {
    handled: true,
    ok: true,
    status: "PENDENTE_REVISAO",
    tipo: "REVISÃO",
    destino: "_inbox_mobile",
    id: id,
    faltando: [pendencia],
    mensagem: mensagem
  };

}


function isCancelamentoMobile_(
  dados,
  request
) {

  const evento =
    normalizeText_(
      dados && dados.evento
    )
    .replace(/[\s-]+/g, "_");

  if (
    evento === "COMPRA_CANCELADA" ||
    evento === "CANCELAMENTO_COMPRA"
  ) {
    return true;
  }

  const texto =
    normalizeText_(
      [
        dados && dados.descricao,
        dados && dados.estabelecimento,
        request &&
          (
            request.conteudo_original ||
            request.texto_original ||
            request.texto ||
            request.raw_text
          )
      ].filter(Boolean).join(" ")
    );

  return (
    /\bCOMPRA\s+CANCELAD[AO]\b/.test(texto) ||
    /\bTRANSACAO\s+CANCELAD[AO]\b/.test(texto) ||
    /\bCANCELAMENTO\s+DE\s+COMPRA\b/.test(texto)
  );

}


function processarCancelamentoMobile_(
  request,
  dados,
  conta,
  funcao,
  origem
) {

  const candidatos =
    localizarComprasCanceladasMobile_(
      dados,
      conta,
      funcao
    );


  if (
    candidatos.length !== 1
  ) {

    const motivo =
      candidatos.length === 0
        ? "compra_original_nao_encontrada"
        : "cancelamento_ambiguo";

    const mensagem =
      candidatos.length === 0
        ? "Não foi encontrada uma compra original única para cancelar."
        : "Mais de uma compra pode corresponder a este cancelamento.";

    const revisao =
      criarRevisaoMobile_(
        request,
        dados,
        origem,
        motivo,
        mensagem
      );

    revisao.tipo =
      "CANCELAMENTO";

    return revisao;

  }


  const compra =
    candidatos[0];

  const sufixo =
    " - Cancelada " +
    formatarDataCancelamentoMobile_(
      new Date()
    );

  const descricaoFinal =
    compra.descricao
      .replace(
        /\s+-\s+Cancelada\s+\d{2}\/\d{2}$/i,
        ""
      )
      .trim() +
    sufixo;

  compra.range
    .getSheet()
    .getRange(
      compra.linha,
      compra.colunaValor
    )
    .setValue(0);

  compra.range
    .getSheet()
    .getRange(
      compra.linha,
      compra.colunaDescricao
    )
    .setValue(
      descricaoFinal
    );

  SpreadsheetApp.flush();

  if (
    compra.tipo === "PARCELAMENTO"
  ) {
    processarParcelasCartao();
  } else {
    FORCAR_ATUALIZACAO();
  }


  return {
    handled: true,
    ok: true,
    status: "CANCELADA",
    tipo: "CANCELAMENTO",
    destino: compra.tipo,
    linha: compra.linha,
    duplicado: false,
    mensagem:
      "Compra marcada como cancelada sem remover a linha."
  };

}


function localizarComprasCanceladasMobile_(
  dados,
  conta,
  funcao
) {

  const dataCompra =
    dados.dataCompraOriginal ||
    dados.data;

  const valorCompra =
    Math.abs(
      Number(dados.valor)
    );

  const estabelecimento =
    obterEstabelecimentoCanceladoMobile_(
      dados
    );

  if (
    !dataCompra ||
    !Number.isFinite(valorCompra) ||
    !conta ||
    !funcao ||
    !estabelecimento
  ) {
    return [];
  }

  const candidatos = [];

  adicionarComprasAvulsasCancelaveisMobile_(
    candidatos,
    dados,
    dataCompra,
    valorCompra,
    conta,
    funcao,
    estabelecimento
  );

  adicionarParcelamentosCancelaveisMobile_(
    candidatos,
    dados,
    dataCompra,
    valorCompra,
    conta,
    funcao,
    estabelecimento
  );

  return candidatos;

}


function adicionarComprasAvulsasCancelaveisMobile_(
  candidatos,
  dados,
  dataCompra,
  valorCompra,
  conta,
  funcao,
  estabelecimento
) {

  const range =
    SpreadsheetApp
      .getActiveSpreadsheet()
      .getRangeByName(
        "data_avulsos"
      );

  if (!range) {
    throw new Error(
      'Intervalo nomeado "data_avulsos" não encontrado.'
    );
  }

  const linhas =
    range.getValues();

  for (
    let indice = 1;
    indice < linhas.length;
    indice++
  ) {

    const linha =
      linhas[indice];

    const data =
      normalizarDataMobile_(
        linha[0]
      );

    const valor =
      Number(linha[1]);

    const contaExistente =
      limparTextoMobile_(
        linha[4]
      );

    const funcaoExistente =
      limparTextoMobile_(
        linha[5]
      );

    const descricao =
      limparTextoMobile_(
        linha[6]
      );

    const cancelada =
      mobileDescricaoCancelada_(
        descricao
      );

    if (
      !data ||
      !descricao ||
      cancelada ||
      normalizeText_(contaExistente) !==
        normalizeText_(conta) ||
      normalizeText_(funcaoExistente) !==
        normalizeText_(funcao) ||
      Math.abs(
        diferencaDiasMobile_(
          data,
          dataCompra
        )
      ) >
        MOBILE_RECONCILIATION_CONFIG.DATE_WINDOW_DAYS ||
      !mobileEstabelecimentoCorresponde_(
        estabelecimento,
        descricao
      )
    ) {
      continue;
    }

    if (
      Math.abs(
        Math.abs(valor) -
        valorCompra
      ) >
        MOBILE_RECONCILIATION_CONFIG.VALUE_TOLERANCE
    ) {
      continue;
    }

    candidatos.push({
      tipo: "AVULSO",
      linha: range.getRow() + indice,
      descricao: descricao,
      range: range,
      colunaValor: range.getColumn() + 1,
      colunaDescricao: range.getColumn() + 6
    });

  }

}


function adicionarParcelamentosCancelaveisMobile_(
  candidatos,
  dados,
  dataCompra,
  valorCompra,
  conta,
  funcao,
  estabelecimento
) {

  if (
    normalizeText_(funcao) !==
    normalizeText_("Crédito")
  ) {
    return;
  }

  const range =
    SpreadsheetApp
      .getActiveSpreadsheet()
      .getRangeByName(
        "data_parcelados_cartao"
      );

  if (!range) {
    throw new Error(
      'Intervalo nomeado "data_parcelados_cartao" não encontrado.'
    );
  }

  const linhas =
    range.getValues();

  for (
    let indice = 1;
    indice < linhas.length;
    indice++
  ) {

    const linha =
      linhas[indice];

    const contaExistente =
      limparTextoMobile_(
        linha[0]
      );

    const descricao =
      limparTextoMobile_(
        linha[1]
      );

    const valor =
      Number(linha[2]);

    const data =
      normalizarDataMobile_(
        linha[4]
      );

    const cancelada =
      mobileDescricaoCancelada_(
        descricao
      );

    if (
      !data ||
      !descricao ||
      cancelada ||
      normalizeText_(contaExistente) !==
        normalizeText_(conta) ||
      Math.abs(
        diferencaDiasMobile_(
          data,
          dataCompra
        )
      ) >
        MOBILE_RECONCILIATION_CONFIG.DATE_WINDOW_DAYS ||
      !mobileEstabelecimentoCorresponde_(
        estabelecimento,
        descricao
      )
    ) {
      continue;
    }

    if (
      Math.abs(
        Math.abs(valor) -
        valorCompra
      ) >
        MOBILE_RECONCILIATION_CONFIG.VALUE_TOLERANCE
    ) {
      continue;
    }

    candidatos.push({
      tipo: "PARCELAMENTO",
      linha: range.getRow() + indice,
      descricao: descricao,
      range: range,
      colunaValor: range.getColumn() + 2,
      colunaDescricao: range.getColumn() + 1
    });

  }

}


function obterEstabelecimentoCanceladoMobile_(
  dados
) {

  const estabelecimento =
    limparTextoMobile_(
      dados.estabelecimento
    );

  if (estabelecimento) {
    return estabelecimento;
  }

  return limparTextoMobile_(
    dados.descricao
      .replace(
        /^\s*(?:compra|transa[cç][aã]o)\s+cancelad[ao]\s+(?:(?:no|na|em|do|da)\s+)?/i,
        ""
      )
      .replace(
        /\s+-\s+cancelad[ao].*$/i,
        ""
      )
  );

}


function mobileEstabelecimentoCorresponde_(
  primeiro,
  segundo
) {

  const tokensPrimeiro =
    mobileTokensEstabelecimento_(
      primeiro
    );

  const tokensSegundo =
    mobileTokensEstabelecimento_(
      segundo
    );

  if (
    tokensPrimeiro.length === 0
  ) {
    return false;
  }

  const correspondeDireto =
    tokensPrimeiro.some(token =>
      tokensSegundo.indexOf(token) >= 0
    );

  if (correspondeDireto) {
    return true;
  }

  return getApelidosEstabelecimentosMobile_()
    .some(apelido =>
      mobileTextoContemTokens_(
        primeiro,
        apelido.estabelecimento
      ) &&
      mobileTextoContemTokens_(
        apelido.origem,
        segundo
      )
    );

}

function mobilePushPixCorrespondeTitular_(
  dados
) {

  const titular =
    normalizeText_(
      MOBILE_RECONCILIATION_CONFIG.ACCOUNT_OWNER_NAME
    );

  return Boolean(
    titular &&
    [
      dados && dados.estabelecimento,
      dados && dados.descricao
    ].some(texto =>
      normalizeText_(texto)
        .includes(titular)
    )
  );

}

function mobilePushPixSemContraparte_(
  dados
) {

  const campos =
    [
      dados && dados.estabelecimento,
      dados && dados.descricao
    ]
      .map(normalizeText_)
      .filter(Boolean);

  const descricaoGenerica =
    /^(?:PIX(?:\s+(?:ENVIADO|RECEBIDO))?|TRANSFERENCIA(?:\s+VIA)?\s+PIX)(?:\s+(?:NO\s+)?(?:APP|APLICATIVO)\s+[A-Z0-9 ]+)?$/;

  return (
    campos.length === 0 ||
    campos.every(texto =>
      descricaoGenerica.test(texto)
    )
  );

}


function mobileTextoContemTokens_(
  primeiro,
  segundo
) {

  const tokensPrimeiro =
    mobileTokensEstabelecimento_(
      primeiro
    );

  const tokensSegundo =
    mobileTokensEstabelecimento_(
      segundo
    );

  return tokensPrimeiro.some(token =>
    tokensSegundo.indexOf(token) >= 0
  );

}


function mobileTokensEstabelecimento_(
  valor
) {

  const ignorar = [
    "COMPRA",
    "COMPRAS",
    "CANCELADA",
    "CANCELADO",
    "CANCELAMENTO",
    "TRANSACAO",
    "ESTORNO",
    "REEMBOLSO",
    "CARTAO",
    "CREDITO",
    "DEBITO",
    "PIX",
    "COMPANHIA",
    "LTDA",
    "S",
    "A",
    "DE",
    "DA",
    "DO",
    "DAS",
    "DOS",
    "NO",
    "NA",
    "EM",
    "PARA"
  ];

  return normalizeText_(valor)
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(token =>
      token.length > 1 &&
      ignorar.indexOf(token) < 0
    );

}


function mobileDescricaoCancelada_(
  descricao
) {

  return /\s+-\s+Cancelada\s+\d{2}\/\d{2}$/i
    .test(
      String(descricao || "")
    );

}


function formatarDataCancelamentoMobile_(
  data
) {

  return [
    String(data.getDate()).padStart(2, "0"),
    String(data.getMonth() + 1).padStart(2, "0")
  ].join("/");

}


function formatarDataIsoMobile_(
  data
) {

  return [
    data.getFullYear(),
    String(data.getMonth() + 1).padStart(2, "0"),
    String(data.getDate()).padStart(2, "0")
  ].join("-");

}


function registrarApelidoEstabelecimentoMobile_(
  estabelecimento,
  tipoOrigem,
  origem
) {

  const apelido =
    limparTextoMobile_(
      estabelecimento
    );

  if (
    !apelido ||
    !origem
  ) {
    return;
  }

  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  let sheet =
    ss.getSheetByName(
      MOBILE_RECONCILIATION_CONFIG.ALIAS_SHEET
    );

  if (!sheet) {
    sheet =
      ss.insertSheet(
        MOBILE_RECONCILIATION_CONFIG.ALIAS_SHEET
      );
  }

  if (sheet.getLastRow() === 0) {
    sheet
      .getRange(
        1,
        1,
        1,
        MOBILE_RECONCILIATION_CONFIG.ALIAS_HEADERS.length
      )
      .setValues([
        MOBILE_RECONCILIATION_CONFIG.ALIAS_HEADERS
      ]);

    sheet.setFrozenRows(1);
  }

  const linhas =
    sheet.getLastRow() > 1
      ? sheet
          .getRange(
            2,
            1,
            sheet.getLastRow() - 1,
            MOBILE_RECONCILIATION_CONFIG.ALIAS_HEADERS.length
          )
          .getDisplayValues()
      : [];

  const existente =
    linhas.some(linha =>
      normalizeText_(linha[0]) ===
        normalizeText_(apelido) &&
      normalizeText_(linha[1]) ===
        normalizeText_(tipoOrigem) &&
      normalizeText_(linha[2]) ===
        normalizeText_(origem)
    );

  if (existente) {
    return;
  }

  sheet.appendRow([
    apelido,
    tipoOrigem,
    origem,
    new Date()
  ]);

  CacheService
    .getScriptCache()
    .remove(
      "mobile_merchant_aliases_v1"
    );

}


function getApelidosEstabelecimentosMobile_() {

  const cache =
    CacheService.getScriptCache();

  const chaveCache =
    "mobile_merchant_aliases_v1";

  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  let sheet =
    ss.getSheetByName(
      MOBILE_RECONCILIATION_CONFIG.ALIAS_SHEET
    );

  if (!sheet) {
    sheet =
      ss.insertSheet(
        MOBILE_RECONCILIATION_CONFIG.ALIAS_SHEET
      );
  }

  if (sheet.getLastRow() === 0) {
    sheet
      .getRange(
        1,
        1,
        1,
        MOBILE_RECONCILIATION_CONFIG.ALIAS_HEADERS.length
      )
      .setValues([
        MOBILE_RECONCILIATION_CONFIG.ALIAS_HEADERS
      ]);

    sheet.setFrozenRows(1);
  }

  const armazenado =
    cache.get(chaveCache);

  if (armazenado !== null) {
    return JSON.parse(armazenado);
  }

  if (sheet.getLastRow() < 2) {
    cache.put(
      chaveCache,
      JSON.stringify([]),
      300
    );

    return [];
  }

  const apelidos =
    sheet
    .getRange(
      2,
      1,
      sheet.getLastRow() - 1,
      MOBILE_RECONCILIATION_CONFIG.ALIAS_HEADERS.length
    )
    .getDisplayValues()
    .map(linha => ({
      estabelecimento: linha[0],
      tipo: linha[1],
      origem: linha[2]
    }))
    .filter(item =>
      item.estabelecimento &&
      item.origem
    );

  cache.put(
    chaveCache,
    JSON.stringify(apelidos),
    300
  );

  return apelidos;

}
