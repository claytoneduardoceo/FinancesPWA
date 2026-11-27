const MOBILE_INBOX_CONFIG = {
  SHEET_NAME: "_inbox_mobile",

  HEADERS: [
    "ID",
    "RECEBIDO_EM",
    "ORIGEM",
    "DATA_TRANSACAO",
    "DESCRICAO",
    "VALOR",
    "MOEDA",
    "CONTA",
    "CARTAO",
    "ESTABELECIMENTO",
    "CATEGORIA_ORIGINAL",
    "LATITUDE",
    "LONGITUDE",
    "OBSERVACOES",
    "PAYLOAD",
    "STATUS"
  ]
};


/**
 * Endpoint do Web App.
 *
 * Recebe a entrada do celular, normaliza e valida os campos,
 * registra entradas incompletas para revisão e grava as válidas.
 */
function doPost(e) {

  let request = null;
  let payload = null;
  let origem = "SMS";

  try {

    if (
      !e ||
      !e.postData ||
      !e.postData.contents
    ) {
      throw new Error(
        "Corpo da requisição não informado."
      );
    }


    request =
      JSON.parse(
        e.postData.contents
      );

    if (
      !request ||
      typeof request !== "object" ||
      Array.isArray(request)
    ) {
      throw new Error(
        "O corpo da requisição deve ser um objeto JSON."
      );
    }

    if (
      String(request.acao || "").trim().toUpperCase() ===
      "COMPRA_BENEFICIO"
    ) {
      return responderJson_(
        inserirCompraBeneficio_(request)
      );
    }


    origem =
      limparTextoMobile_(
        request.origem
      ) || "SMS";


    let erroInterpretacao = "";

    if (
      Object.prototype.hasOwnProperty.call(
        request,
        "resposta_modelo"
      )
    ) {

      try {

        payload =
          parseRespostaModelo_(
            request.resposta_modelo
          );

      } catch (erro) {

        payload = {};

        erroInterpretacao =
          String(
            erro.message || erro
          ).substring(0, 250);

      }

    } else {

      payload =
        request;

    }

    const dados =
      normalizarLancamentoMobile_(
        payload
      );

    if (
      request.evento ||
      request.tipo_evento
    ) {
      dados.evento =
        normalizarEventoMobile_(
          request.evento ||
          request.tipo_evento
        );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        request,
        "compromisso_id"
      ) ||
      Object.prototype.hasOwnProperty.call(
        request,
        "compromissoId"
      )
    ) {
      dados.compromissoId =
        normalizarIdCompromissoMobile_(
          request.compromisso_id ||
          request.compromissoId
        );
    }

    if (
      request.estabelecimento ||
      request.merchant
    ) {
      dados.estabelecimento =
        limparTextoMobile_(
          request.estabelecimento ||
          request.merchant
        );
    }

    if (
      request.data_compra_original ||
      request.dataCompraOriginal
    ) {
      dados.dataCompraOriginal =
        normalizarDataMobile_(
          request.data_compra_original ||
          request.dataCompraOriginal
        );
    }

    if (dados.evento === "IGNORAR") {
      const logRegistrado =
        registrarMobileChangelog_({
          origem: origem,
          tipo: "NOTIFICACAO",
          status: "IGNORADO_NAO_TRANSACIONAL",
          mensagem:
            "Notificação sem movimentação financeira.",
          payload: request
        });

      if (!logRegistrado) {
        throw new Error(
          "Não foi possível registrar a notificação ignorada no changelog."
        );
      }

      return responderJson_({
        ok: true,
        status: "IGNORADO_NAO_TRANSACIONAL",
        mensagem:
          "Notificação sem transação financeira ignorada."
      });
    }


    let conta =
      dados.conta;

    let funcao =
      dados.funcao;

    const origemPush =
      normalizeText_(origem) === "PUSH";

    /*
     * Para notificações push, o mapa cadastrado
     * é a referência de conta e função do cartão.
     */
    const beneficioCartao =
      origemPush && dados.cartaoFinal
        ? obterBeneficioPorCartao_(dados.cartaoFinal)
        : null;

    let cartaoMap =
      null;

    if (
      dados.cartaoFinal &&
      !beneficioCartao &&
      (
        origemPush ||
        !conta ||
        !funcao
      )
    ) {
      cartaoMap =
        getCartaoMap_(
          dados.cartaoFinal
        );

      if (cartaoMap) {
        if (origemPush) {
          conta = cartaoMap.conta || conta;
          funcao = cartaoMap.funcao || funcao;
        } else {
          if (!conta) {
            conta = cartaoMap.conta;
          }

          if (!funcao) {
            funcao = cartaoMap.funcao;
          }
        }
      }
    }

    if (beneficioCartao) {
      conta = beneficioCartao.agency;
      funcao = "Benefício";
    }

    if (
      dados.parcelas > 1 &&
      !funcao
    ) {
      funcao = "Crédito";
    }


    funcao =
      normalizarFuncaoMobile_(
        funcao
      );

    dados.conta =
      conta;

    dados.funcao =
      funcao;

    if (
      origemPush &&
      dados.cartaoFinal &&
      !cartaoMap &&
      !beneficioCartao &&
      dados.evento === "COMPRA" &&
      normalizeText_(funcao) !== "PIX"
    ) {
      const pendencias = [
        "cartao_final_nao_cadastrado"
      ];

      const id =
        registrarEntradaPendenteMobile_(
          request,
          payload,
          dados,
          conta,
          pendencias,
          origem,
          "",
          "ALERTA_CARTAO_NAO_MAPEADO"
        );

      const logRegistrado =
        registrarMobileChangelog_({
          origem: origem,
          tipo: "ALERTA",
          status: "ALERTA_CARTAO_NAO_MAPEADO",
          cartaoFinal: dados.cartaoFinal,
          conta: conta,
          funcao: funcao,
          valor: dados.valor,
          parcelas: dados.parcelas,
          data: dados.data,
          descricao: dados.descricao,
          mensagem:
            "Compra push recebida com cartão final não cadastrado em _cartoes_map; enviada para revisão, sem lançamento automático.",
          payload: request
        });

      if (!logRegistrado) {
        throw new Error(
          "Não foi possível registrar o alerta de cartão não mapeado."
        );
      }

      return responderJson_({
        ok: true,
        status: "ALERTA_CARTAO_NAO_MAPEADO",
        id: id,
        faltando: pendencias,
        mensagem:
          "Compra salva para revisão: cadastre o cartão em _cartoes_map."
      });
    }

    dados.transferenciaPropria =
      toBoolean_(
        payload.transferencia_propria ??
        payload.transferenciaPropria ??
        request.transferencia_propria ??
        request.transferenciaPropria
      );

    const pixComMovimentoValido =
      ["ENTRADA", "SAIDA"].indexOf(
        dados.tipoMovimento
      ) >= 0 &&
      normalizeText_(funcao) ===
        normalizeText_("Pix");

    const pixNomeadoAoTitular =
      origemPush &&
      pixComMovimentoValido &&
      mobilePushPixCorrespondeTitular_(
        dados
      );

    if (
      pixComMovimentoValido &&
      (
        dados.transferenciaPropria ||
        pixNomeadoAoTitular
      )
    ) {

      const logRegistrado =
        registrarMobileChangelog_({
        origem: origem,
        tipo: "PIX_PROPRIO",
        status: "IGNORADO_TRANSFERENCIA_PROPRIA",
        cartaoFinal: dados.cartaoFinal,
        conta: conta,
        funcao: funcao,
        valor: dados.valor,
        parcelas: dados.parcelas,
        data: dados.data,
        descricao: dados.descricao,
        mensagem:
          pixNomeadoAoTitular &&
          !dados.transferenciaPropria
            ? "Pix identificado pelo nome do titular; não foi lançado."
            : "Pix entre contas próprias; não foi lançado.",
        payload: request
      });

      if (!logRegistrado) {
        throw new Error(
          "Não foi possível registrar no changelog o Pix entre contas próprias."
        );
      }

      return responderJson_({
        ok: true,
        status: "IGNORADO_TRANSFERENCIA_PROPRIA",
        mensagem:
          "Pix entre contas próprias registrado no log e ignorado."
      });

    }

    if (
      origemPush &&
      dados.evento === "COMPRA" &&
      pixComMovimentoValido &&
      mobilePushPixSemContraparte_(
        dados
      )
    ) {
      const logRegistrado =
        registrarMobileChangelog_({
          origem: origem,
          tipo: "PIX",
          status: "IGNORADO_PIX_SEM_CONTRAPARTE",
          conta: conta,
          funcao: funcao,
          valor: dados.valor,
          parcelas: dados.parcelas,
          data: dados.data,
          descricao: dados.descricao,
          mensagem:
            "Notificação Pix genérica sem pessoa ou estabelecimento identificado; ignorada.",
          payload: request
        });

      if (!logRegistrado) {
        throw new Error(
          "Não foi possível registrar a notificação Pix genérica ignorada."
        );
      }

      return responderJson_({
        ok: true,
        status: "IGNORADO_PIX_SEM_CONTRAPARTE",
        mensagem:
          "Notificação Pix sem contraparte identificável ignorada."
      });
    }


    if (
      isCancelamentoMobile_(
        dados,
        request
      )
    ) {

      const resultadoCancelamento =
        executarComLockMobile_(() =>
          processarCancelamentoMobile_(
            request,
            dados,
            conta,
            funcao,
            origem
          )
        );

      registrarMobileChangelog_({
        origem: origem,
        tipo: "CANCELAMENTO",
        status: resultadoCancelamento.status,
        cartaoFinal: dados.cartaoFinal,
        conta: conta,
        funcao: funcao,
        valor: dados.valor,
        parcelas: dados.parcelas,
        data: dados.data,
        descricao: dados.descricao,
        destino: resultadoCancelamento.destino,
        linha: resultadoCancelamento.linha,
        mensagem: resultadoCancelamento.mensagem,
        payload: request
      });

      return responderJson_(
        resultadoCancelamento
      );

    }


    const resultadoConciliacao =
      normalizeText_(funcao) === normalizeText_("Benefício")
        ? null
        : executarComLockMobile_(() =>
            processarConciliacaoCompromissoMobile_(
              dados,
              origem,
              request
            )
          );

    if (
      resultadoConciliacao &&
      resultadoConciliacao.handled
    ) {

      registrarMobileChangelog_({
        origem: origem,
        tipo: resultadoConciliacao.tipo,
        status: resultadoConciliacao.status,
        cartaoFinal: dados.cartaoFinal,
        conta: conta,
        funcao: funcao,
        valor: dados.valor,
        parcelas: dados.parcelas,
        data: dados.data,
        descricao: dados.descricao,
        destino: resultadoConciliacao.destino,
        linha: resultadoConciliacao.linha,
        mensagem:
          resultadoConciliacao.mensagem ||
          (
            resultadoConciliacao.duplicado
              ? "Movimentação já conciliada."
              : "Compromisso conciliado."
          ),
        payload: request
      });

      return responderJson_(
        resultadoConciliacao
      );

    }


    const pendencias =
      validarLancamentoMobile_(
        dados,
        conta,
        funcao
      );

    if (erroInterpretacao) {
      pendencias.push("resposta_modelo");
    }


    if (pendencias.length > 0) {

      const id =
        registrarEntradaPendenteMobile_(
          request,
          payload,
          dados,
          conta,
          pendencias,
          origem,
          erroInterpretacao
        );


      registrarMobileChangelog_({

        origem: origem,
        tipo: "REVISÃO",
        status: "PENDENTE_REVISAO",
        cartaoFinal: dados.cartaoFinal,
        conta: conta,
        funcao: funcao,
        valor: dados.valor,
        parcelas: dados.parcelas,
        data: dados.data,
        descricao: dados.descricao,
        categoria: dados.categoria,
        mensagem:
          "Campos pendentes: " +
          pendencias.join(", "),
        payload: request

      });


      return responderJson_({

        ok: true,
        status: "PENDENTE_REVISAO",
        id: id,
        faltando: pendencias,
        mensagem:
          "Lançamento salvo na fila para revisão."

      });

    }


    let resultado;
    let tipo;
    let destino;


    if (dados.parcelas > 1) {

      tipo =
        "PARCELAMENTO";

      destino =
        "Parcelamentos Cartão";


      resultado =
        adicionarParcelamentoCartao(
          conta,
          dados.descricao,
          dados.valor,
          dados.parcelas,
          dados.data,
          false
        );

    } else {

      tipo =
        "AVULSO";

      destino =
        "Avulsos";

      const valorFinal =
        ajustarSinalValor_(
          dados.valor,
          dados.tipoMovimento,
          funcao
        );

      resultado =
        adicionarAvulso(
          dados.data,
          valorFinal,
          dados.categoria,
          conta,
          funcao,
          dados.descricao,
          false,
          dados.hora,
          true,
          false,
          dados.tipoMovimento
        );

    }

    if (
      resultado &&
      resultado.needsReview
    ) {
      const pendencias = [
        "possivel_duplicidade_data_valor_conta_funcao_hora"
      ];
      const id = registrarEntradaPendenteMobile_(
        request,
        payload,
        dados,
        conta,
        pendencias,
        origem,
        ""
      );
      const mensagem =
        "Há um avulso com a mesma data, valor, conta e função; horário igual ou indisponível. Enviado para revisão sem criar outro lançamento.";

      registrarMobileChangelog_({
        origem: origem,
        tipo: "REVISÃO",
        status: "PENDENTE_REVISAO",
        cartaoFinal: dados.cartaoFinal,
        conta: conta,
        funcao: funcao,
        valor: dados.valor,
        parcelas: dados.parcelas,
        data: dados.data,
        descricao: dados.descricao,
        categoria: dados.categoria,
        destino: "Inbox mobile",
        mensagem: mensagem,
        payload: request
      });

      return responderJson_({
        ok: true,
        status: "PENDENTE_REVISAO",
        tipo: "AVULSO",
        destino: "Inbox mobile",
        id: id,
        faltando: pendencias,
        mensagem: mensagem
      });
    }


    /*
     * Registra sucesso ou duplicidade
     * para ambos os tipos.
     */
    registrarMobileChangelog_({

      origem: origem,

      tipo:
        tipo,

      status:
        resultado.status,

      cartaoFinal:
        dados.cartaoFinal,

      conta:
        conta,

      funcao:
        funcao,

      valor:
        dados.valor,

      parcelas:
        dados.parcelas,

      data:
        dados.data,

      descricao:
        dados.descricao,

      categoria:
        dados.categoria,

      destino:
        destino,

      linha:
        resultado.linha,

      mensagem:
        resultado.duplicado
          ? "Registro já existente."
          : `Inserido na linha ${resultado.linha}`,

      payload:
        request

    });


    return responderJson_({

      ok: true,

      status:
        resultado.status,

      tipo:
        tipo,

      destino:
        destino,

      duplicado:
        resultado.duplicado,

      linha:
        resultado.linha,

      dados: {

        cartao_final:
          dados.cartaoFinal,

        data:
          dados.data,

        valor:
          dados.valor,

        parcelas:
          dados.parcelas,

        descricao:
          dados.descricao,

        categoria:
          dados.categoria,

        conta:
          conta,

        funcao:
          funcao

      }

    });


  } catch (erro) {

    registrarMobileChangelog_({

      origem:
        origem,

      tipo:
        "",

      status:
        "ERRO",

      mensagem:
        String(
          erro.message || erro
        ),

      payload:
        request ||
        (
          e &&
          e.postData &&
          e.postData.contents
        ) ||
        payload

    });

    return responderJson_({

      ok: false,
      status:
        "ERRO",
      erro:
        String(
          erro.message || erro
        )

    });

  }

}

function normalizarLancamentoMobile_(payload) {

  const possuiParcelas =
    Object.prototype.hasOwnProperty.call(
      payload,
      "parcelas"
    );


  return {

    cartaoFinal:
      String(
        payload.cartao_final ||
        payload.cartaoFinal ||
        payload.cartao ||
        ""
      ).trim(),

    conta:
      limparTextoMobile_(
        payload.conta
      ),

    funcao:
      limparTextoMobile_(
        payload.funcao
      ),

    data:
      normalizarDataMobile_(
        payload.data ||
        payload.dataTransacao ||
        payload.transactionDate
      ),

    hora:
      limparTextoMobile_(
        payload.hora
      ),

    valor:
      normalizarNumeroMobile_(
        payload.valor ??
        payload.amount
      ),

    parcelas:
      possuiParcelas
        ? normalizarParcelasMobile_(
            payload.parcelas
          )
        : 1,

    descricao:
      limparTextoMobile_(
        payload.descricao
      ),

    categoria:
      limparTextoMobile_(
        payload.categoria
      ),

    tipoMovimento:
      normalizarTipoMovimentoMobile_(
        payload.tipo_movimento ||
        payload.tipoMovimento
      ),

    evento:
      normalizarEventoMobile_(
        payload.evento ||
        payload.tipo_evento ||
        payload.tipoEvento
      ),

    transferenciaPropria:
      toBoolean_(
        payload.transferencia_propria ??
        payload.transferenciaPropria
      ),

    estabelecimento:
      limparTextoMobile_(
        payload.estabelecimento ||
        payload.comerciante ||
        payload.merchant
      ),

    compromissoId:
      normalizarIdCompromissoMobile_(
        payload.compromisso_id ||
        payload.compromissoId
      ),

    dataCompraOriginal:
      normalizarDataMobile_(
        payload.data_compra_original ||
        payload.dataCompraOriginal
      ),

  };

}

function normalizarParcelasMobile_(valor) {

  if (
    valor === null ||
    valor === undefined ||
    valor === ""
  ) {
    return null;
  }


  if (typeof valor === "number") {
    return Number.isInteger(valor)
      ? valor
      : null;
  }


  const correspondencia =
    String(valor)
      .trim()
      .match(
        /^(\d+)\s*(?:x|parcelas?)?$/i
      );


  return correspondencia
    ? Number(correspondencia[1])
    : null;

}

function normalizarFuncaoMobile_(valor) {

  const texto =
    limparTextoMobile_(
      valor
    );

  if (/^cr[eé]dito$/i.test(texto)) {
    return "Crédito";
  }

  if (/^d[eé]bito$/i.test(texto)) {
    return "Débito";
  }

  if (/^pix$/i.test(texto)) {
    return "Pix";
  }

  if (/^benef[ií]cio$/i.test(texto)) {
    return "Benefício";
  }

  return texto;

}

function normalizarTipoMovimentoMobile_(valor) {

  const texto =
    limparTextoMobile_(
      valor
    )
    .toUpperCase();

  if (texto === "SAÍDA") {
    return "SAIDA";
  }

  return texto;

}

function validarLancamentoMobile_(
  dados,
  conta,
  funcao
) {

  const pendencias = [];


  if (!dados.data) {
    pendencias.push("data");
  }

  if (
    dados.valor === null ||
    !Number.isFinite(dados.valor)
  ) {
    pendencias.push("valor");
  }

  if (!dados.descricao) {
    pendencias.push("descricao");
  }

  if (!conta) {
    pendencias.push("conta");
  }

  if (
    ["Crédito", "Débito", "Pix", "Benefício"].indexOf(funcao) < 0
  ) {
    pendencias.push("funcao");
  }

  if (
    normalizeText_(funcao) === normalizeText_("Benefício") &&
    !obterBeneficioPorAgencia_(conta)
  ) {
    pendencias.push("beneficio_nao_vinculado");
  }

  if (
    dados.parcelas === null ||
    !Number.isInteger(dados.parcelas) ||
    dados.parcelas < 1
  ) {
    pendencias.push("parcelas");
  }


  if (
    dados.parcelas !== null &&
    dados.parcelas <= 1
  ) {

    if (
      dados.tipoMovimento !== "ENTRADA" &&
      dados.tipoMovimento !== "SAIDA"
    ) {
      pendencias.push("tipo_movimento");
    }


    if (!dados.categoria) {
      pendencias.push("categoria");
    } else {

      const categorias =
        getCategoriasConfigMobile_()
          .categorias;

      if (
        categorias.indexOf(
          dados.categoria
        ) < 0
      ) {
        pendencias.push("categoria");
      }

    }

  }


  if (
    dados.parcelas > 1 &&
    funcao !== "Crédito"
  ) {
    pendencias.push("funcao");
  }


  return pendencias.filter(
    (item, indice) =>
      pendencias.indexOf(item) === indice
  );

}

function registrarEntradaPendenteMobile_(
  request,
  payload,
  dados,
  conta,
  pendencias,
  origem,
  erroInterpretacao,
  status
) {

  const registro =
    normalizarEntradaMobile_(
      request
    );

  const textoOriginal =
    String(
      request.conteudo_original ||
      request.texto_original ||
      request.texto ||
      request.raw_text ||
      ""
    ).trim();


  registro.origem =
    origem;

  registro.dataTransacao =
    dados.data;

  registro.descricao =
    dados.descricao ||
    textoOriginal.substring(0, 250);

  registro.valor =
    dados.valor;

  registro.conta =
    conta ||
    dados.conta;

  registro.cartao =
    dados.cartaoFinal ||
    registro.cartao;

  registro.categoriaOriginal =
    dados.categoria;

  registro.estabelecimento =
    dados.estabelecimento ||
    registro.estabelecimento;

  registro.observacoes =
    [
      registro.observacoes,
      "Campos pendentes: " +
        pendencias.join(", "),
      erroInterpretacao
    ]
    .filter(Boolean)
    .join(" | ");

  registro.status =
    status ||
    "PENDENTE_REVISAO";


  return registrarEntradaMobile_(
    registro,
    {
      request: request,
      dados_extraidos: payload,
      campos_pendentes: pendencias,
      erro_interpretacao:
        erroInterpretacao || ""
    }
  );

}

function getCartaoMap_(cartaoFinal) {

  const ss =
    SpreadsheetApp
      .getActiveSpreadsheet();


  const range =
    ss.getRangeByName(
      "_cartoes_map"
    );


  if (!range) {

    throw new Error(
      'Intervalo nomeado "_cartoes_map" não encontrado.'
    );

  }


  const dados =
    range.getDisplayValues();


  const chave =
    String(
      cartaoFinal || ""
    ).trim();


  for (
    let i = 0;
    i < dados.length;
    i++
  ) {

    const final =
      String(
        dados[i][0] || ""
      ).trim();


    if (final === chave) {

      return {
        final: final,

        conta:
          String(
            dados[i][1] || ""
          ).trim(),

        funcao:
          String(
            dados[i][2] || ""
          ).trim()
      };

    }

  }


  return null;

}

/**
 * Transforma o JSON recebido em um formato
 * previsível para armazenamento.
 *
 * Ainda não existe inteligência financeira aqui.
 */
function normalizarEntradaMobile_(payload) {

  const agora =
    new Date();


  return {

    id:
      gerarIdEntradaMobile_(),

    recebidoEm:
      agora,

    origem:
      limparTextoMobile_(
        payload.origem
      ) || "ATALHO_IOS",

    dataTransacao:
      normalizarDataMobile_(
        payload.data ||
        payload.dataTransacao ||
        payload.transactionDate
      ),

    descricao:
      limparTextoMobile_(
        payload.descricao ||
        payload.description ||
        payload.nome
      ),

    valor:
      normalizarNumeroMobile_(
        payload.valor ||
        payload.amount
      ),

    moeda:
      limparTextoMobile_(
        payload.moeda ||
        payload.currency
      ) || "BRL",

    conta:
      limparTextoMobile_(
        payload.conta ||
        payload.account
      ),

    cartao:
      limparTextoMobile_(
        payload.cartao ||
        payload.card
      ),

    estabelecimento:
      limparTextoMobile_(
        payload.estabelecimento ||
        payload.comerciante ||
        payload.merchant
      ),

    categoriaOriginal:
      limparTextoMobile_(
        payload.categoria ||
        payload.category
      ),

    latitude:
      normalizarNumeroMobile_(
        payload.latitude
      ),

    longitude:
      normalizarNumeroMobile_(
        payload.longitude
      ),

    observacoes:
      limparTextoMobile_(
        payload.observacoes ||
        payload.notas ||
        payload.notes
      ),

    status:
      "PENDENTE"

  };

}



/**
 * Grava efetivamente na aba de inbox.
 */
function registrarEntradaMobile_(
  registro,
  payload
) {

  const ss =
    SpreadsheetApp
      .getActiveSpreadsheet();


  let sheet =
    ss.getSheetByName(
      MOBILE_INBOX_CONFIG.SHEET_NAME
    );


  if (!sheet) {

    sheet =
      ss.insertSheet(
        MOBILE_INBOX_CONFIG.SHEET_NAME
      );

  }


  garantirCabecalhoMobile_(
    sheet
  );


  const linha = [

    registro.id,

    registro.recebidoEm,

    registro.origem,

    registro.dataTransacao || "",

    registro.descricao || "",

    registro.valor ?? "",

    registro.moeda || "",

    registro.conta || "",

    registro.cartao || "",

    registro.estabelecimento || "",

    registro.categoriaOriginal || "",

    registro.latitude ?? "",

    registro.longitude ?? "",

    registro.observacoes || "",

    JSON.stringify(
      payload
    ),

    registro.status

  ];


  sheet.appendRow(
    linha
  );

  return registro.id;

}



/**
 * Cria o cabeçalho caso a aba esteja vazia.
 */
function garantirCabecalhoMobile_(sheet) {

  if (
    sheet.getLastRow() > 0
  ) {
    return;
  }


  sheet
    .getRange(
      1,
      1,
      1,
      MOBILE_INBOX_CONFIG.HEADERS.length
    )
    .setValues([
      MOBILE_INBOX_CONFIG.HEADERS
    ]);


  sheet.setFrozenRows(1);

}



/**
 * ID independente da lógica financeira principal.
 *
 * Exemplo:
 * MOB_20260810_211245_A1B2C3
 */
function gerarIdEntradaMobile_() {

  const agora =
    new Date();


  const data =
    Utilities.formatDate(
      agora,
      Session.getScriptTimeZone(),
      "yyyyMMdd_HHmmss"
    );


  const random =
    Utilities
      .getUuid()
      .replace(/-/g, "")
      .substring(0, 6)
      .toUpperCase();


  return (
    "MOB_" +
    data +
    "_" +
    random
  );

}



/**
 * Conversão defensiva de número.
 */
function normalizarNumeroMobile_(valor) {

  if (
    valor === null ||
    valor === undefined ||
    valor === ""
  ) {
    return null;
  }


  if (
    typeof valor === "number"
  ) {

    return isNaN(valor)
      ? null
      : valor;

  }


  let texto =
    String(valor)
      .trim();


  /*
   * Aceita por exemplo:
   *
   * 89.90
   * 89,90
   * R$ 89,90
   * R$ 1.234,56
   */

  texto =
    texto.replace(
      /[^\d,.\-]/g,
      ""
    );


  if (
    texto.includes(",")
  ) {

    texto =
      texto
        .replace(/\./g, "")
        .replace(",", ".");

  }


  const numero =
    Number(texto);


  return isNaN(numero)
    ? null
    : numero;

}



/**
 * Conversão defensiva de data.
 */
function normalizarDataMobile_(valor) {

  if (!valor) {
    return null;
  }


  /*
   * Se já for Date válido, mantém.
   */
  if (
    valor instanceof Date &&
    !isNaN(valor.getTime())
  ) {
    return valor;
  }


  const texto =
    String(valor)
      .trim();


  /*
   * Formato brasileiro:
   *
   * DD/MM/AAAA
   *
   * Exemplo:
   * 11/08/2026
   */
  const br =
    texto.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/
    );

  if (br) {

    const dia =
      Number(br[1]);

    const mes =
      Number(br[2]);

    let ano =
      Number(br[3]);

    if (br[3].length === 2) {
      ano += 2000;
    }


    const data =
      new Date(
        ano,
        mes - 1,
        dia
      );


    /*
     * Validação adicional.
     * Evita aceitar coisas como 31/02/2026.
     */
    if (
      data.getFullYear() !== ano ||
      data.getMonth() !== mes - 1 ||
      data.getDate() !== dia
    ) {
      return null;
    }


    return data;

  }


  /*
   * Outros formatos confiáveis,
   * como ISO:
   *
   * 2026-08-11
   * 2026-08-11T15:30:00-03:00
   */
  const iso =
    texto.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/
    );

  if (iso) {

    const ano =
      Number(iso[1]);

    const mes =
      Number(iso[2]);

    const dia =
      Number(iso[3]);

    const dataIso =
      new Date(
        ano,
        mes - 1,
        dia,
        12,
        0,
        0
      );

    if (
      dataIso.getFullYear() !== ano ||
      dataIso.getMonth() !== mes - 1 ||
      dataIso.getDate() !== dia
    ) {
      return null;
    }

    return dataIso;

  }

  const data =
    new Date(texto);


  if (
    isNaN(data.getTime())
  ) {
    return null;
  }


  return data;

}



/**
 * Evita undefined/null e remove espaços
 * desnecessários.
 */
function limparTextoMobile_(valor) {

  if (
    valor === null ||
    valor === undefined
  ) {
    return "";
  }


  return String(valor)
    .trim();

}



/**
 * Resposta padrão da API.
 */
function responderJson_(objeto) {

  return ContentService
    .createTextOutput(
      JSON.stringify(objeto)
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );
}

function doGet(e) {

  try {

    const recurso =
      String(
        e?.parameter?.recurso || ""
      )
      .trim()
      .toLowerCase();

    if (recurso === "fatura") {
      return responderJson_(
        carregarFaturaApi_(e && e.parameter || {})
      );
    }

      if (recurso === 'saldo') {

      const dados =
        getSaldoTimelineHoje_();

      const saldoFalado =
        valorParaFala_(
          dados.saldo
        );

      const disponivelFalado =
        valorParaFala_(
          dados.disponivel
        );

      return responderJson_({

        ok: true,

        ...dados,

        fala:
          'Você tem ' +
          saldoFalado +
          ' em conta, sendo ' +
          disponivelFalado +
          ' disponíveis para gastar.'

      });
    }

    if (recurso === "beneficio_saldo") {
      const id =
        String(
          e?.parameter?.beneficio_id ||
            e?.parameter?.id ||
            ""
        ).trim();
      const agencia =
        String(
          e?.parameter?.agencia ||
            ""
        ).trim();
      const dataTexto = String(
        e?.parameter?.data || ""
      ).trim();
      const mesTexto = String(
        e?.parameter?.mes || ""
      ).trim();

      if (!id && !agencia) {
        throw new Error(
          "Informe beneficio_id ou agencia para consultar a carteira."
        );
      }

      const beneficio = id
        ? null
        : obterBeneficioPorAgencia_(agencia);
      if (!id && !beneficio) {
        throw new Error(
          `Carteira de benefício ativa "${agencia}" não encontrada.`
        );
      }

      if (dataTexto && mesTexto) {
        throw new Error(
          'Use apenas um dos parâmetros "data" ou "mes".'
        );
      }

      let dataReferencia = new Date();
      if (mesTexto) {
        const partesMes = /^(\d{4})-(\d{2})$/.exec(mesTexto);
        if (!partesMes || Number(partesMes[2]) < 1 || Number(partesMes[2]) > 12) {
          throw new Error(
            'O parâmetro "mes" deve estar no formato AAAA-MM.'
          );
        }
        dataReferencia = new Date(
          Number(partesMes[1]),
          Number(partesMes[2]),
          0,
          12
        );
      } else if (dataTexto) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dataTexto)) {
          throw new Error(
            'O parâmetro "data" deve estar no formato AAAA-MM-DD.'
          );
        }
        dataReferencia = normalizarDataMobile_(dataTexto);
      }
      if (!dataReferencia) {
        throw new Error(
          'O parâmetro "data" deve estar no formato AAAA-MM-DD.'
        );
      }

      const saldo = obterSaldoBeneficio_(
        id || beneficio.id,
        dataReferencia
      );

      return responderJson_({
        ok: true,
        ...saldo,
        ...obterEstiloAgenciaBeneficio_(saldo.agency)
      });
    }

    if (recurso === "pendencias") {
      const mes =
        String(
          e?.parameter?.mes ||
            Utilities.formatDate(
              new Date(),
              Session.getScriptTimeZone(),
              "yyyy-MM"
            )
        ).trim();
      const dados =
        carregarPainelCompromissos(mes);

      return responderJson_({
        ok: true,
        month: dados.month,
        monthLabel: dados.monthLabel,
        summary: dados.summary,
        items: dados.items
      });
    }

    if (recurso === "contexto") {

      const tipo =
        String(
          e?.parameter?.tipo || "DEFAULT"
        )
        .trim()
        .toUpperCase();

      const dados =
        getContextoMobile_(
          tipo,
          true
        );

      return responderJson_({
        ok: true,
        tipo: tipo,
        contexto_financeiro_disponivel: true,
        categorias: dados.categorias,
        contexto: dados.contexto,
        compromissos: dados.compromissos,
        apelidos_estabelecimentos:
          dados.apelidos_estabelecimentos,
        cartoes_map:
          dados.cartoes_map,
        script: dados.script
      });

    }


    return responderJson_({
      ok: false,
      erro: "Recurso inválido."
    });


  } catch (erro) {

    return responderJson_({
      ok: false,
      erro: String(
        erro.message || erro
      )
    });

  }

}

function parseRespostaModelo_(valor) {

  if (
    valor &&
    typeof valor === "object" &&
    !Array.isArray(valor)
  ) {
    return valor;
  }


  if (typeof valor !== "string") {
    throw new Error(
      "Resposta do modelo deve ser um objeto ou texto JSON."
    );
  }


  let texto =
    valor
      .trim();


  /*
   * Remove ```json ... ```
   * caso o modelo eventualmente envie markdown.
   */
  texto =
    texto
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();


  let resposta;

  try {

    resposta =
      JSON.parse(
        texto
      );

  } catch (erro) {

    throw new Error(
      "Resposta do modelo não contém JSON válido: " +
      texto
    );

  }

  if (
    !resposta ||
    typeof resposta !== "object" ||
    Array.isArray(resposta)
  ) {
    throw new Error(
      "A resposta do modelo precisa ser um objeto JSON."
    );
  }

  return resposta;

}

function registrarMobileChangelog_(dados) {

  try {

    const ss =
      SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
      ss.getSheetByName(
        "_inbox_mobile_changelog"
      );

    if (!sheet) {
      throw new Error(
        'Aba "_inbox_mobile_changelog" não encontrada.'
      );
    }

    const ultimaColuna =
      sheet.getLastColumn();

    const colunaPayload =
      ultimaColuna > 0
        ? sheet
            .getRange(1, 1, 1, ultimaColuna)
            .getDisplayValues()[0]
            .findIndex(valor =>
              normalizeText_(valor) === "PAYLOAD"
            ) + 1
        : 0;

    if (
      colunaPayload > 0 &&
      !sheet
        .getRange(1, colunaPayload + 1)
        .getValue()
    ) {
      sheet
        .getRange(1, colunaPayload + 1)
        .setValue("TEXTO_BASE");
    }

    const textoBase =
      dados.textoBase ??
      (
        dados.payload &&
        (
          dados.payload.texto_base ??
          dados.payload.textoBase
        )
      ) ??
      "";

    sheet.appendRow([
      new Date(),

      dados.tipo || "",

      dados.status || "",

      dados.cartaoFinal || "",

      dados.conta || "",

      dados.funcao || "",

      dados.valor ?? "",

      dados.parcelas ?? "",

      dados.data || "",

      dados.descricao || "",

      dados.categoria || "",

      dados.destino || "",

      dados.linha ?? "",

      dados.mensagem || "",

      dados.payload
        ? JSON.stringify(dados.payload)
        : "",

      textoBase
    ]);

    return true;

  } catch (erro) {

    /*
     * Falha no changelog NÃO deve impedir
     * o lançamento financeiro.
     */
    console.error(
      "Erro ao registrar changelog mobile:",
      erro
    );

    return false;

  }

}

function getSaldoTimelineHoje_() {

  const hoje = normalizarDiaTimeline_(
    new Date()
  );

  const referencia = new Date(
    hoje.getFullYear(),
    hoje.getMonth(),
    1
  );

  /*
   * Precisamos exibir histórico porque queremos
   * localizar explicitamente a linha de hoje.
   */
  const timeline = GET_TIMELINE(
    "refresh_Token",
    referencia,
    true,
    0
  );

  if (
    !Array.isArray(timeline) ||
    timeline.length < 2
  ) {
    throw new Error(
      'Timeline não retornou dados.'
    );
  }

  /*
   * Estrutura:
   *
   * 0 DATA
   * 1 ENTRADAS
   * 2 SAÍDAS
   * 3 MOVIMENTO
   * 4 SALDO
   * 5 SALDO COMPETÊNCIA
   * 6 DISPONÍVEL
   * 7 LANÇAMENTOS
   */

  const linhaHoje =
    timeline
      .slice(1)
      .find(linha => {

        const data =
          normalizarDiaTimeline_(
            linha[0]
          );

        return (
          data &&
          data.getTime() ===
            hoje.getTime()
        );
      });

  if (!linhaHoje) {
    throw new Error(
      'Não foi possível localizar hoje na Timeline.'
    );
  }

  return {
    data:
      Utilities.formatDate(
        hoje,
        Session.getScriptTimeZone(),
        'dd/MM/yyyy'
      ),

    saldo:
      Number(linhaHoje[4]) || 0,

    disponivel:
      Number(linhaHoje[6]) || 0
  };
}

function valorParaFala_(valor) {

  const numero =
    Math.round(Number(valor) * 100) / 100;

  const reais =
    Math.floor(numero);

  const centavos =
    Math.round(
      (numero - reais) * 100
    );

  let texto =
    reais + (
      reais === 1
        ? ' real'
        : ' reais'
    );

  if (centavos > 0) {
    texto +=
      ' e ' +
      centavos +
      (
        centavos === 1
          ? ' centavo'
          : ' centavos'
      );
  }

  return texto;
}