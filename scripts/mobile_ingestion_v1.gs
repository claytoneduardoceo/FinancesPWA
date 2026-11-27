var FINANCE_API_V1_MOBILE = {
  EVENT_SHEET: "EXTERNAL_EVENTS",
  MAX_BODY_LENGTH: 50000,
  MAX_PAYLOAD_LENGTH: 45000,
  REVIEW_STATUS: "UNVERIFIED",
  RECONCILIATION_DATE_WINDOW_DAYS: 5,
  RECONCILIATION_VALUE_TOLERANCE: 5,
  EVENT_HEADERS: [
    "ID", "WORKSPACE_ID", "EXTERNAL_ID", "ENTRY_TYPE", "RECEIVED_AT",
    "TRANSACTION_DATE", "DESCRIPTION", "AMOUNT", "CURRENCY", "ACCOUNT_ID",
    "CARD_LAST_FOUR", "MERCHANT", "CATEGORY_LABEL", "LATITUDE", "LONGITUDE",
    "NOTES", "PROCESSING_STATUS", "PAYLOAD_JSON", "SOURCE_TYPE",
    "CREATED_AT", "UPDATED_AT", "RECORD_VERSION", "DELETED_AT"
  ]
};

function financeApiV1MobileIsRequest_(event) {
  var parameters = event && event.parameter || {};
  return String(parameters.recurso || "").trim().toLowerCase() === "contexto";
}

function financeApiV1MobileDoGet_(event) {
  try {
    var parameters = event && event.parameter || {};
    if (String(parameters.recurso || "").trim().toLowerCase() !== "contexto") {
      financeApiV1Throw_("MOBILE_RESOURCE_NOT_FOUND", "Recurso mobile desconhecido.");
    }
    return financeApiV1Json_({
      ok: true,
      tipo: financeApiV1MobileEntryType_(parameters.tipo),
      contexto_financeiro_disponivel: true,
      ...financeApiV1MobileBuildContext_(
        financeApiV1MobileWorkspaceId_(),
        parameters.tipo
      )
    });
  } catch (error) {
    return financeApiV1ErrorResponse_(error);
  }
}

function financeApiV1MobileBuildContext_(workspaceId, requestedType) {
  var accounts = financeApiV1DashboardReadRows_(
    "ACCOUNTS",
    ["NAME", "CURRENCY", "STATUS"],
    workspaceId
  ).filter(financeApiV1MobileIsActive_);
  var categories = financeApiV1DashboardReadRows_(
    "CATEGORIES",
    ["NAME", "DISPLAY_NAME", "CATEGORY_TYPE", "STATUS"],
    workspaceId
  ).filter(financeApiV1MobileIsActive_);
  var cards = financeApiV1DashboardReadRows_(
    "CARDS",
    ["ACCOUNT_ID", "ISSUER_NAME", "STATUS"],
    workspaceId
  ).filter(financeApiV1MobileIsActive_);
  var identifiers = financeApiV1DashboardReadRows_(
    "CARD_IDENTIFIERS",
    ["CARD_ID", "LAST_FOUR", "PAYMENT_FUNCTION"],
    workspaceId
  );
  var accountById = {};
  accounts.forEach(function(account) {
    accountById[String(account.ID)] = account;
  });
  var cardById = {};
  cards.forEach(function(card) {
    cardById[String(card.ID)] = card;
  });
  var cardMap = identifiers.map(function(identifier) {
    var card = cardById[String(identifier.CARD_ID || "")];
    var account = card && accountById[String(card.ACCOUNT_ID || "")];
    return card && account ? {
      cartao_final: String(identifier.LAST_FOUR || ""),
      conta: String(account.NAME || ""),
      funcao: String(identifier.PAYMENT_FUNCTION || ""),
      card_id: String(card.ID || "")
    } : null;
  }).filter(Boolean);

  var benefitCards = financeApiV1DashboardReadRows_(
    "BENEFIT_CARDS",
    ["BENEFIT_WALLET_ID", "LAST_FOUR"],
    workspaceId
  );
  var wallets = financeApiV1DashboardReadRows_(
    "BENEFIT_WALLETS",
    ["ACCOUNT_ID", "ISSUER_NAME", "ACTIVE"],
    workspaceId
  ).filter(function(wallet) {
    return financeApiV1MobileIsEnabled_(wallet.ACTIVE);
  });
  var walletById = {};
  wallets.forEach(function(wallet) {
    walletById[String(wallet.ID)] = wallet;
  });
  benefitCards.forEach(function(identifier) {
    var wallet = walletById[String(identifier.BENEFIT_WALLET_ID || "")];
    var account = wallet && accountById[String(wallet.ACCOUNT_ID || "")];
    if (wallet && account) {
      cardMap.push({
        cartao_final: String(identifier.LAST_FOUR || ""),
        conta: String(account.NAME || ""),
        funcao: "Benefício",
        card_id: ""
      });
    }
  });

  var aliases = financeApiV1DashboardReadRows_(
    "MERCHANT_ALIASES",
    ["MERCHANT_KEY", "ENTRY_TYPE", "CANONICAL_NAME", "CONFIRMED_AT"],
    workspaceId
  ).filter(function(alias) {
    return Boolean(alias.CANONICAL_NAME);
  }).map(function(alias) {
    return {
      apelido: String(alias.MERCHANT_KEY || ""),
      nome: String(alias.CANONICAL_NAME || ""),
      tipo: String(alias.ENTRY_TYPE || "")
    };
  });
  var dashboard = financeApiV1BuildDashboard_(workspaceId, 90);
  var commitments = dashboard.commitments.map(function(item) {
    return {
      id: item.id,
      data: item.date,
      tipo: item.direction === "INCOME" ? "Rendas" : "Despesas",
      origem: item.source,
      descricao: item.description,
      valor: item.amount,
      status: item.status,
      conta_id: item.accountId,
      conta: item.accountName
    };
  });
  var prompt = financeApiV1MobilePrompt_(workspaceId, requestedType, {
    categories: categories,
    aliases: aliases,
    commitments: commitments,
    cardMap: cardMap
  });
  return {
    categorias: categories.map(function(category) {
      return String(category.DISPLAY_NAME || category.NAME || "");
    }).filter(Boolean),
    contexto: [],
    compromissos: commitments,
    apelidos_estabelecimentos: aliases,
    cartoes_map: cardMap,
    script: prompt
  };
}

function financeApiV1MobilePrompt_(workspaceId, requestedType, context) {
  var table = financeApiV1ReadTable_("PROMPT_CONFIGS", [
    "ID", "WORKSPACE_ID", "ENTRY_TYPE", "PROMPT_TEXT", "ACTIVE",
    "PROMPT_VERSION", "DELETED_AT"
  ]);
  var workspaceIndex = table.headers.indexOf("WORKSPACE_ID");
  var typeIndex = table.headers.indexOf("ENTRY_TYPE");
  var activeIndex = table.headers.indexOf("ACTIVE");
  var deletedIndex = table.headers.indexOf("DELETED_AT");
  var textIndex = table.headers.indexOf("PROMPT_TEXT");
  var requested = financeApiV1MobileEntryType_(requestedType);
  var row = table.rows.filter(function(item) {
    return String(item[workspaceIndex]) === workspaceId &&
      String(item[typeIndex] || "").trim().toUpperCase() === requested &&
      financeApiV1MobileIsEnabled_(item[activeIndex]) &&
      !item[deletedIndex];
  })[0];
  if (!row && requested !== "DEFAULT") {
    row = table.rows.filter(function(item) {
      return String(item[workspaceIndex]) === workspaceId &&
        String(item[typeIndex] || "").trim().toUpperCase() === "DEFAULT" &&
        financeApiV1MobileIsEnabled_(item[activeIndex]) &&
        !item[deletedIndex];
    })[0];
  }
  if (!row || !String(row[textIndex] || "").trim()) {
    financeApiV1Throw_(
      "MOBILE_PROMPT_NOT_FOUND",
      "Não há prompt ativo configurado para esta origem."
    );
  }
  var replacements = {
    "{{CATEGORIAS}}": context.categories.map(function(category) {
      return "- " + String(category.DISPLAY_NAME || category.NAME || "");
    }).filter(function(value) {
      return value !== "- ";
    }).join("\n"),
    "{{CONTEXTO}}": "",
    "{{COMPROMISSOS}}": JSON.stringify(context.commitments),
    "{{APELIDOS}}": JSON.stringify(context.aliases),
    "{{CARTOES_MAP}}": JSON.stringify(context.cardMap)
  };
  var prompt = String(row[textIndex]);
  Object.keys(replacements).forEach(function(token) {
    prompt = prompt.split(token).join(replacements[token]);
  });
  return prompt;
}

function financeApiV1MobileDoPost_(event) {
  var lock = LockService.getScriptLock();
  var eventState = null;
  var request = null;
  var parseError = null;
  var workspaceId = "";
  var rawBody = event && event.postData
    ? String(event.postData.contents || "")
    : "";
  lock.waitLock(30000);
  try {
    workspaceId = financeApiV1MobileWorkspaceId_();
    if (rawBody.length > FINANCE_API_V1_MOBILE.MAX_BODY_LENGTH) {
      eventState = financeApiV1MobileStartEvent_(
        workspaceId, null, rawBody, "Corpo maior que 50 KB."
      );
      financeApiV1MobileFinishEvent_(
        eventState, "ERRO", "Corpo maior que 50 KB.", null, null
      );
      return financeApiV1Json_({
        ok: false,
        status: "ERRO",
        erro: "Corpo maior que 50 KB.",
        id: eventState.id
      });
    }
    try {
      request = rawBody ? JSON.parse(rawBody) : null;
      if (!request || typeof request !== "object" || Array.isArray(request)) {
        parseError = new Error("O corpo da requisição deve ser um objeto JSON.");
        request = null;
      }
    } catch (error) {
      parseError = new Error("O corpo da requisição não contém JSON válido.");
    }

    eventState = financeApiV1MobileStartEvent_(
      workspaceId, request, rawBody, parseError && parseError.message
    );
    if (eventState.duplicateOf) {
      financeApiV1MobileFinishEvent_(
        eventState, "DUPLICADO",
        "Já existe um evento processado com este identificador externo.",
        null,
        { duplicateOf: eventState.duplicateOf.id }
      );
      return financeApiV1Json_({
        ok: true,
        status: "DUPLICADO",
        id: eventState.id,
        eventoOriginalId: eventState.duplicateOf.id
      });
    }
    if (parseError) {
      financeApiV1MobileFinishEvent_(
        eventState, "ERRO", parseError.message, null, null
      );
      return financeApiV1Json_({
        ok: false,
        status: "ERRO",
        erro: parseError.message,
        id: eventState.id
      });
    }
    if (!request) {
      var missingBody = "Corpo da requisição não informado.";
      financeApiV1MobileFinishEvent_(
        eventState, "ERRO", missingBody, null, null
      );
      return financeApiV1Json_({
        ok: false,
        status: "ERRO",
        erro: missingBody,
        id: eventState.id
      });
    }

    var action = String(request.acao || request.action || "")
      .trim().toUpperCase();
    if (action && action !== "MOBILE.INGEST") {
      var invalidAction = "Ação não suportada pelo endpoint mobile.";
      financeApiV1MobileFinishEvent_(
        eventState, "ERRO", invalidAction, null, null
      );
      return financeApiV1Json_({
        ok: false,
        status: "ERRO",
        erro: invalidAction,
        id: eventState.id
      });
    }

    var parsed = financeApiV1MobileExtract_(request);
    parsed.mobileEventId = eventState.id;
    if (!eventState.externalId && parsed.externalId) {
      eventState.externalId = parsed.externalId;
      financeApiV1MobilePatchEvent_(eventState, {
        EXTERNAL_ID: parsed.externalId
      });
      var priorEvent = financeApiV1MobileFindPriorCompletedEvent_(
        eventState.workspaceId,
        eventState.entryType,
        parsed.externalId,
        eventState.id
      );
      if (priorEvent) {
        financeApiV1MobileFinishEvent_(
          eventState,
          "DUPLICADO",
          "Já existe um evento processado com este identificador externo.",
          parsed,
          { duplicateOf: priorEvent.ID }
        );
        return financeApiV1Json_({
          ok: true,
          status: "DUPLICADO",
          id: eventState.id,
          eventoOriginalId: String(priorEvent.ID)
        });
      }
    }
    financeApiV1MobileUpdateEventFields_(eventState, parsed);
    if (parsed.event === "IGNORAR") {
      financeApiV1MobileFinishEvent_(
        eventState, "IGNORADO_NAO_TRANSACIONAL",
        "Notificação sem movimentação financeira.", parsed, null
      );
      return financeApiV1Json_({
        ok: true,
        status: "IGNORADO_NAO_TRANSACIONAL",
        id: eventState.id
      });
    }
    if (parsed.transferenciaPropria) {
      financeApiV1MobileFinishEvent_(
        eventState, "IGNORADO_TRANSFERENCIA_PROPRIA",
        "Movimentação entre contas próprias ignorada.", parsed, null
      );
      return financeApiV1Json_({
        ok: true,
        status: "IGNORADO_TRANSFERENCIA_PROPRIA",
        id: eventState.id
      });
    }
    if (
      parsed.entryType === "PUSH" &&
      parsed.event === "COMPRA" &&
      parsed.paymentFunction === "Pix" &&
      parsed.direction &&
      financeApiV1MobileIsGenericPix_(parsed)
    ) {
      financeApiV1MobileFinishEvent_(
        eventState,
        "IGNORADO_PIX_SEM_CONTRAPARTE",
        "Notificação Pix genérica sem contraparte identificada.",
        parsed,
        null
      );
      return financeApiV1Json_({
        ok: true,
        status: "IGNORADO_PIX_SEM_CONTRAPARTE",
        id: eventState.id
      });
    }

    var resolved = financeApiV1MobileResolveReferences_(
      eventState.workspaceId, parsed, eventState.entryType
    );
    parsed.account = resolved.account;
    parsed.card = resolved.card;
    parsed.category = resolved.category;
    parsed.paymentFunction = resolved.paymentFunction;
    if (!parsed.currency && resolved.account) {
      parsed.currency = String(resolved.account.CURRENCY || "BRL");
    }
    parsed.missing = parsed.missing.concat(resolved.missing);
    if (parsed.interpretationError) parsed.missing.push("resposta_modelo");
    parsed.missing = financeApiV1MobileUnique_(parsed.missing);
    financeApiV1MobileUpdateEventFields_(eventState, parsed);

    if (parsed.event === "COMPRA_CANCELADA") {
      var cancellation = financeApiV1MobileCancelTransaction_(
        eventState, parsed
      );
      if (cancellation.pending) {
        financeApiV1MobileFinishEvent_(
          eventState, "PENDENTE_REVISAO",
          cancellation.message, parsed, cancellation
        );
        return financeApiV1Json_({
          ok: true,
          status: "PENDENTE_REVISAO",
          id: eventState.id,
          faltando: [cancellation.reason],
          mensagem: cancellation.message
        });
      }
      financeApiV1MobileFinishEvent_(
        eventState, "CANCELADA",
        "Lançamento original cancelado.", parsed, cancellation
      );
      return financeApiV1Json_({
        ok: true,
        status: "CANCELADA",
        id: eventState.id,
        transactionId: cancellation.transactionId
      });
    }

    if (parsed.missing.length) {
      var pendingMessage = "Dados insuficientes: " + parsed.missing.join(", ");
      financeApiV1MobileFinishEvent_(
        eventState, "PENDENTE_REVISAO",
        pendingMessage, parsed, { missing: parsed.missing }
      );
      return financeApiV1Json_({
        ok: true,
        status: "PENDENTE_REVISAO",
        id: eventState.id,
        faltando: parsed.missing,
        mensagem: pendingMessage
      });
    }

    var match = financeApiV1MobileFindCommitment_(
      eventState.workspaceId, parsed
    );
    if (match.pending) {
      financeApiV1MobileFinishEvent_(
        eventState, "PENDENTE_REVISAO",
        match.message, parsed, match
      );
      return financeApiV1Json_({
        ok: true,
        status: "PENDENTE_REVISAO",
        id: eventState.id,
        faltando: [match.reason],
        mensagem: match.message
      });
    }
    var duplicate = financeApiV1MobileFindDuplicateTransaction_(
      eventState.workspaceId, parsed
    );
    if (
      duplicate &&
      (!match.commitment || match.commitment.source !== "TRANSACTION")
    ) {
      var duplicateMessage =
        "Possível lançamento duplicado; enviado para revisão.";
      financeApiV1MobileFinishEvent_(
        eventState, "PENDENTE_REVISAO",
        duplicateMessage, parsed,
        { reason: "possivel_duplicidade", transactionId: duplicate.ID }
      );
      return financeApiV1Json_({
        ok: true,
        status: "PENDENTE_REVISAO",
        id: eventState.id,
        faltando: ["possivel_duplicidade"],
        mensagem: duplicateMessage
      });
    }

    var result = financeApiV1MobileApplyTransaction_(
      eventState, parsed, match.commitment || null
    );
    financeApiV1MobileFinishEvent_(
      eventState, result.status, result.message, parsed, result
    );
    return financeApiV1Json_({
      ok: true,
      status: result.status,
      id: eventState.id,
      transactionId: result.transactionId || "",
      installmentPlanId: result.installmentPlanId || "",
      mensagem: result.message
    });
  } catch (error) {
    if (eventState) {
      try {
        financeApiV1MobileFinishEvent_(
          eventState,
          "ERRO",
          error && error.message ? String(error.message) : "Falha inesperada.",
          null,
          { possiblePartialWrite: true }
        );
      } catch (logError) {
        console.error("Falha ao atualizar o log mobile:", logError);
      }
    }
    return financeApiV1Json_({
      ok: false,
      status: "ERRO",
      erro: error && error.message
        ? String(error.message)
        : "Falha inesperada na ingestão mobile.",
      id: eventState ? eventState.id : ""
    });
  } finally {
    lock.releaseLock();
  }
}

function financeApiV1MobileExtract_(request) {
  var source = financeApiV1MobileEntryType_(
    request.origem || request.source || request.tipo
  );
  var payload = request;
  var interpretationError = "";
  if (Object.prototype.hasOwnProperty.call(request, "resposta_modelo")) {
    try {
      payload = financeApiV1MobileParseModel_(request.resposta_modelo);
    } catch (error) {
      payload = {};
      interpretationError = String(error.message || error).substring(0, 300);
    }
  }
  var transactionDate = financeApiV1MobileDate_(
    payload.data || payload.dataTransacao || payload.transactionDate
  );
  var amount = financeApiV1MobileNumber_(
    payload.valor !== undefined ? payload.valor : payload.amount
  );
  if (amount !== null) amount = Math.abs(amount);
  var rawInstallments = payload.parcelas === undefined ? 1 : payload.parcelas;
  var installments = financeApiV1MobileNumber_(rawInstallments);
  var direction = financeApiV1MobileDirection_(
    payload.tipo_movimento || payload.tipoMovimento || payload.direction
  );
  var eventType = financeApiV1MobileNormalize_(
    request.evento || request.tipo_evento ||
    payload.evento || payload.tipo_evento || payload.tipoEvento || "COMPRA"
  ).toUpperCase();
  var eventAliases = {
    "CANCELAMENTO": "COMPRA_CANCELADA",
    "CANCELAMENTO_COMPRA": "COMPRA_CANCELADA",
    "CANCELAMENTO COMPRA": "COMPRA_CANCELADA",
    "CANCELAMENTO DA COMPRA": "COMPRA_CANCELADA",
    "COMPRA CANCELADA": "COMPRA_CANCELADA",
    "CANCELADA": "COMPRA_CANCELADA",
    "ESTORNO": "ESTORNO",
    "REEMBOLSO": "ESTORNO",
    "IGNORAR": "IGNORAR"
  };
  eventType = eventAliases[eventType] || eventType;
  if (eventType === "COMPRA_CANCELADA") {
    transactionDate = financeApiV1MobileDate_(
      request.data_compra_original || request.dataCompraOriginal ||
      payload.data_compra_original || payload.dataCompraOriginal
    ) || transactionDate;
  }
  if (eventType === "ESTORNO") direction = "INCOME";
  var description = financeApiV1MobileText_(
    payload.descricao || payload.description || payload.nome
  );
  var merchant = financeApiV1MobileText_(
    request.estabelecimento || request.merchant ||
    payload.estabelecimento || payload.comerciante || payload.merchant
  );
  var sourceText = financeApiV1MobileText_(
    request.origem || request.source || request.tipo
  );
  var missing = [];
  if (!transactionDate) missing.push("data");
  if (amount === null || amount <= 0) missing.push("valor");
  if (!description) missing.push("descricao");
  if (!direction && eventType !== "COMPRA_CANCELADA") {
    missing.push("tipo_movimento");
  }
  if (!Number.isInteger(installments) || installments < 1) {
    missing.push("parcelas");
  }
  if (
    eventType !== "COMPRA_CANCELADA" &&
    eventType !== "IGNORAR" &&
    installments <= 1 &&
    !financeApiV1MobileText_(payload.categoria || payload.category)
  ) {
    missing.push("categoria");
  }
  return {
    source: sourceText,
    entryType: source,
    event: eventType,
    date: transactionDate,
    amount: amount,
    currency: financeApiV1MobileText_(
      payload.moeda || payload.currency
    ).toUpperCase(),
    description: description,
    merchant: merchant,
    accountName: financeApiV1MobileText_(payload.conta || payload.account),
    cardLastFour: financeApiV1MobileLastFour_(
      payload.cartao_final || payload.cartaoFinal || payload.cartao ||
      payload.card || request.cartao_final || request.cartaoFinal
    ),
    categoryLabel: financeApiV1MobileText_(
      payload.categoria || payload.category
    ),
    paymentFunction: financeApiV1MobileFunction_(
      payload.funcao || payload.paymentFunction
    ),
    direction: direction,
    installments: installments,
    commitmentId: financeApiV1MobileText_(
      request.compromisso_id || request.compromissoId ||
      payload.compromisso_id || payload.compromissoId
    ),
    ownTransfer: financeApiV1MobileIsTrue_(
      payload.transferencia_propria !== undefined
        ? payload.transferencia_propria
        : payload.transferenciaPropria !== undefined
          ? payload.transferenciaPropria
          : request.transferencia_propria || request.transferenciaPropria
    ),
    latitude: financeApiV1MobileNumber_(
      request.latitude !== undefined ? request.latitude : payload.latitude
    ),
    longitude: financeApiV1MobileNumber_(
      request.longitude !== undefined ? request.longitude : payload.longitude
    ),
    externalId: financeApiV1MobileExternalId_(request, payload),
    interpretationError: interpretationError,
    missing: missing,
    originalPayload: payload
  };
}

function financeApiV1MobileParseModel_(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") {
    throw new Error("A resposta do modelo deve ser um objeto ou JSON.");
  }
  var text = value.trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  var result;
  try {
    result = JSON.parse(text);
  } catch (error) {
    throw new Error("A resposta do modelo não contém JSON válido.");
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("A resposta do modelo precisa ser um objeto JSON.");
  }
  return result;
}

function financeApiV1MobileResolveReferences_(workspaceId, data, entryType) {
  var missing = [];
  var accounts = financeApiV1DashboardReadRows_(
    "ACCOUNTS",
    ["NAME", "CURRENCY", "STATUS"],
    workspaceId
  ).filter(financeApiV1MobileIsActive_);
  var cards = financeApiV1DashboardReadRows_(
    "CARDS",
    ["ACCOUNT_ID", "ISSUER_NAME", "STATUS"],
    workspaceId
  ).filter(financeApiV1MobileIsActive_);
  var identifiers = financeApiV1DashboardReadRows_(
    "CARD_IDENTIFIERS",
    ["CARD_ID", "LAST_FOUR", "PAYMENT_FUNCTION"],
    workspaceId
  );
  var wallets = financeApiV1DashboardReadRows_(
    "BENEFIT_WALLETS",
    ["ACCOUNT_ID", "ISSUER_NAME", "ACTIVE"],
    workspaceId
  ).filter(function(wallet) {
    return financeApiV1MobileIsEnabled_(wallet.ACTIVE);
  });
  var benefitCards = financeApiV1DashboardReadRows_(
    "BENEFIT_CARDS",
    ["BENEFIT_WALLET_ID", "LAST_FOUR"],
    workspaceId
  );
  var account = null;
  var card = null;
  var paymentFunction = data.paymentFunction;
  if (data.accountName) {
    var accountMatches = accounts.filter(function(item) {
      return financeApiV1MobileNormalize_(item.NAME) ===
        financeApiV1MobileNormalize_(data.accountName);
    });
    if (accountMatches.length === 1) account = accountMatches[0];
    else missing.push(accountMatches.length ? "conta_ambigua" : "conta");
  }
  if (data.cardLastFour) {
    var cardMatches = identifiers.filter(function(item) {
      return String(item.LAST_FOUR || "").replace(/\D/g, "") ===
        data.cardLastFour;
    }).map(function(identifier) {
      var matchedCard = cards.filter(function(item) {
        return String(item.ID) === String(identifier.CARD_ID);
      })[0];
      return matchedCard ? {
        identifier: identifier,
        card: matchedCard,
        account: accounts.filter(function(item) {
          return String(item.ID) === String(matchedCard.ACCOUNT_ID);
        })[0] || null
      } : null;
    }).filter(function(item) {
      return item && item.account;
    });
    var benefitMatches = benefitCards.filter(function(item) {
      return String(item.LAST_FOUR || "").replace(/\D/g, "") ===
        data.cardLastFour;
    }).map(function(identifier) {
      var wallet = wallets.filter(function(item) {
        return String(item.ID) === String(identifier.BENEFIT_WALLET_ID);
      })[0];
      return wallet ? {
        identifier: identifier,
        card: null,
        account: accounts.filter(function(item) {
          return String(item.ID) === String(wallet.ACCOUNT_ID);
        })[0] || null
      } : null;
    }).filter(function(item) {
      return item && item.account;
    });
    var allMatches = cardMatches.concat(benefitMatches);
    if (allMatches.length === 1) {
      card = allMatches[0].card;
      var mappedAccount = allMatches[0].account;
      if (account && String(account.ID) !== String(mappedAccount.ID)) {
        missing.push("conta_diverge_do_cartao");
      } else {
        account = mappedAccount;
      }
      var mappedFunction = allMatches[0].card
        ? financeApiV1MobileFunction_(
          allMatches[0].identifier.PAYMENT_FUNCTION
        )
        : "Benefício";
      if (paymentFunction && paymentFunction !== mappedFunction) {
        missing.push("funcao_diverge_do_cartao");
      }
      paymentFunction = mappedFunction;
    } else if (allMatches.length > 1) {
      missing.push("cartao_ambiguo");
    } else if (
      ["Crédito", "Débito", "Benefício"].indexOf(data.paymentFunction) >= 0
    ) {
      missing.push("cartao_nao_mapeado");
    }
  } else if (
    ["Crédito", "Débito", "Benefício"].indexOf(data.paymentFunction) >= 0
  ) {
    missing.push("cartao_nao_informado");
  }
  if (!account) missing.push("conta");

  var category = null;
  if (data.categoryLabel) {
    var categories = financeApiV1DashboardReadRows_(
      "CATEGORIES",
      ["NAME", "DISPLAY_NAME", "CATEGORY_TYPE", "STATUS"],
      workspaceId
    ).filter(financeApiV1MobileIsActive_);
    var categoryMatches = categories.filter(function(item) {
      var label = financeApiV1MobileNormalize_(data.categoryLabel);
      return financeApiV1MobileNormalize_(item.DISPLAY_NAME) === label ||
        financeApiV1MobileNormalize_(item.NAME) === label;
    });
    if (categoryMatches.length === 1) category = categoryMatches[0];
    else missing.push(categoryMatches.length ? "categoria_ambigua" : "categoria");
  } else if (data.installments <= 1 && data.event !== "COMPRA_CANCELADA") {
    missing.push("categoria");
  }
  if (
    data.paymentFunction &&
    ["Crédito", "Débito", "Pix", "Benefício"].indexOf(paymentFunction) < 0
  ) {
    missing.push("funcao");
  }
  if (!paymentFunction) missing.push("funcao");
  if (
    data.currency &&
    !/^[A-Z]{3}$/.test(data.currency.trim().toUpperCase())
  ) {
    missing.push("moeda_invalida");
  }
  if (
    account &&
    data.currency &&
    String(account.CURRENCY || "").toUpperCase() !==
      data.currency.trim().toUpperCase()
  ) {
    missing.push("moeda_diverge_da_conta");
  }
  if (
    data.installments > 1 &&
    paymentFunction !== "Crédito"
  ) {
    missing.push("parcelamento_exige_credito");
  }
  return {
    account: account,
    card: card,
    category: category,
    paymentFunction: paymentFunction,
    missing: financeApiV1MobileUnique_(missing)
  };
}

function financeApiV1MobileFindCommitment_(workspaceId, data) {
  var dashboard = financeApiV1BuildDashboard_(workspaceId, 90);
  var commitments = dashboard.commitments.slice();
  var knownIds = {};
  commitments.forEach(function(item) {
    if (item && item.id) knownIds[String(item.id)] = true;
  });
  var transactionRows = financeApiV1DashboardReadRows_(
    "TRANSACTIONS",
    [
      "ACCOUNT_ID", "CARD_ID", "DIRECTION", "AMOUNT", "CURRENCY",
      "OCCURRED_AT", "DESCRIPTION", "REVIEW_STATUS", "VISIBILITY_STATUS",
      "DELETED_AT"
    ],
    workspaceId
  );
  var today = Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"
  );
  transactionRows.forEach(function(transaction) {
    var id = String(transaction.ID || "");
    var date = financeApiV1DashboardDateKey_(transaction.OCCURRED_AT);
    var status = String(transaction.REVIEW_STATUS || "").toUpperCase();
    var visibility = String(transaction.VISIBILITY_STATUS || "").toUpperCase();
    if (
      !id || knownIds[id] || transaction.DELETED_AT ||
      ["HIDDEN", "DELETED", "ARCHIVED"].indexOf(visibility) >= 0 ||
      financeApiV1DashboardIsClosed_(status) ||
      (date < today && [
        "PENDING", "PENDING_DATA", "UNVERIFIED", "SCHEDULED", "PLANNED", "DUE"
      ].indexOf(status) < 0)
    ) return;
    commitments.push({
      id: id,
      date: date,
      description: String(transaction.DESCRIPTION || ""),
      amount: financeApiV1DashboardMoney_(transaction.AMOUNT),
      currency: financeApiV1DashboardCurrency_(transaction.CURRENCY),
      direction: financeApiV1DashboardDirection_(transaction.DIRECTION),
      accountId: String(transaction.ACCOUNT_ID || ""),
      source: "TRANSACTION",
      status: status
    });
    knownIds[id] = true;
  });

  var transactionDate = financeApiV1DashboardDateKey_(data.date);
  if (transactionDate) {
    var fromDate = financeApiV1DashboardAddDays_(
      transactionDate,
      -FINANCE_API_V1_MOBILE.RECONCILIATION_DATE_WINDOW_DAYS
    );
    var throughDate = financeApiV1DashboardAddDays_(
      transactionDate,
      FINANCE_API_V1_MOBILE.RECONCILIATION_DATE_WINDOW_DAYS
    );
    financeApiV1MobileAppendRecurrenceCandidates_(
      workspaceId, fromDate, throughDate, commitments, knownIds
    );
    financeApiV1MobileAppendDebtCandidates_(
      workspaceId, fromDate, throughDate, commitments, knownIds
    );
  }

  var candidates = commitments.filter(function(item) {
    if (!item || item.amount === null || !item.date) return false;
    if (item.direction !== data.direction) return false;
    if (
      data.account &&
      item.accountId &&
      String(item.accountId) !== String(data.account.ID)
    ) return false;
    if (
      data.currency &&
      item.currency &&
      String(item.currency).toUpperCase() !== data.currency.toUpperCase()
    ) return false;
    var date = financeApiV1MobileDate_(item.date);
    if (!date || Math.abs(financeApiV1MobileDayDifference_(date, data.date)) >
      FINANCE_API_V1_MOBILE.RECONCILIATION_DATE_WINDOW_DAYS) return false;
    return Math.abs(Math.abs(Number(item.amount)) - Math.abs(data.amount)) <=
      FINANCE_API_V1_MOBILE.RECONCILIATION_VALUE_TOLERANCE;
  });
  if (data.commitmentId) {
    var exact = candidates.filter(function(item) {
      return String(item.id) === data.commitmentId;
    });
    if (exact.length === 1) return { commitment: exact[0] };
    return {
      pending: true,
      reason: "compromisso_indisponivel",
      message: "O compromisso informado não está disponível ou diverge dos dados."
    };
  }
  if (candidates.length <= 1) {
    if (candidates.length === 1) {
      return financeApiV1MobileMerchantSelect_(candidates, data, workspaceId);
    }
    return { commitment: null };
  }
  return financeApiV1MobileMerchantSelect_(candidates, data, workspaceId);
}

function financeApiV1MobileAppendRecurrenceCandidates_(
  workspaceId, fromDate, throughDate, commitments, knownIds
) {
  var recurrences = financeApiV1DashboardReadRows_(
    "RECURRENCES",
    [
      "ACCOUNT_ID", "RULE_TYPE", "DESCRIPTION", "AMOUNT", "CURRENCY",
      "START_DATE", "END_DATE", "DUE_DAY", "STATUS"
    ],
    workspaceId
  );
  var events = financeApiV1DashboardReadRows_(
    "RECURRENCE_EVENTS",
    [
      "RECURRENCE_ID", "OCCURRENCE_DATE", "EVENT_STATUS",
      "TRANSACTION_ID", "AMOUNT"
    ],
    workspaceId
  );
  var eventsByKey = {};
  events.forEach(function(event) {
    eventsByKey[
      String(event.RECURRENCE_ID || "") + "|" +
      financeApiV1DashboardDateKey_(event.OCCURRENCE_DATE)
    ] = event;
  });
  recurrences.forEach(function(recurrence) {
    if (!financeApiV1DashboardIsActive_(recurrence.STATUS)) return;
    var recurrenceId = String(recurrence.ID || "");
    var currency = financeApiV1DashboardCurrency_(recurrence.CURRENCY);
    var amount = financeApiV1DashboardMoney_(recurrence.AMOUNT);
    var direction = financeApiV1DashboardDirection_(recurrence.RULE_TYPE);
    if (!recurrenceId || !currency || amount === null) return;
    financeApiV1DashboardMonthlyOccurrences_(
      recurrence.START_DATE,
      recurrence.END_DATE,
      recurrence.DUE_DAY,
      fromDate,
      throughDate,
      null
    ).forEach(function(occurrence) {
      var id = "recurrence:" + recurrenceId + ":" + occurrence.date;
      if (knownIds[id]) return;
      var event = eventsByKey[recurrenceId + "|" + occurrence.date];
      if (event) {
        var eventStatus = String(event.EVENT_STATUS || "").toUpperCase();
        if (
          event.TRANSACTION_ID ||
          financeApiV1DashboardIsClosed_(eventStatus) ||
          ["PENDING", "SCHEDULED", "PLANNED", "OPEN", "DUE"].indexOf(
            eventStatus
          ) < 0
        ) return;
      }
      var eventAmount = event
        ? financeApiV1DashboardMoney_(event.AMOUNT)
        : amount;
      if (eventAmount === null) return;
      commitments.push({
        id: id,
        date: occurrence.date,
        description: String(recurrence.DESCRIPTION || "Recorrência"),
        amount: Math.abs(eventAmount),
        currency: currency,
        direction: direction,
        accountId: String(recurrence.ACCOUNT_ID || ""),
        source: "RECURRENCE",
        status: event ? String(event.EVENT_STATUS || "") : "PROJECTED"
      });
      knownIds[id] = true;
    });
  });
}

function financeApiV1MobileAppendDebtCandidates_(
  workspaceId, fromDate, throughDate, commitments, knownIds
) {
  var accounts = financeApiV1DashboardReadRows_(
    "ACCOUNTS",
    ["CURRENCY", "STATUS"],
    workspaceId
  );
  var currencyByAccount = {};
  accounts.forEach(function(account) {
    currencyByAccount[String(account.ID || "")] =
      financeApiV1DashboardCurrency_(account.CURRENCY);
  });
  var debts = financeApiV1DashboardReadRows_(
    "DEBTS",
    [
      "ACCOUNT_ID", "DESCRIPTION", "INSTALLMENT_COUNT", "DUE_DAY",
      "START_DATE", "END_DATE", "INSTALLMENT_AMOUNT", "STATUS"
    ],
    workspaceId
  );
  debts.forEach(function(debt) {
    if (!financeApiV1DashboardIsActive_(debt.STATUS)) return;
    var debtId = String(debt.ID || "");
    var accountId = String(debt.ACCOUNT_ID || "");
    var currency = currencyByAccount[accountId];
    var amount = financeApiV1DashboardMoney_(debt.INSTALLMENT_AMOUNT);
    if (!debtId || !currency || amount === null) return;
    financeApiV1DashboardMonthlyOccurrences_(
      debt.START_DATE,
      debt.END_DATE,
      debt.DUE_DAY,
      fromDate,
      throughDate,
      debt.INSTALLMENT_COUNT
    ).forEach(function(occurrence) {
      var id = "debt:" + debtId + ":" + occurrence.date;
      if (knownIds[id]) return;
      commitments.push({
        id: id,
        date: occurrence.date,
        description: String(debt.DESCRIPTION || "Parcela de dívida"),
        amount: Math.abs(amount),
        currency: currency,
        direction: "EXPENSE",
        accountId: accountId,
        source: "DEBT",
        status: "PROJECTED"
      });
      knownIds[id] = true;
    });
  });
}

function financeApiV1MobileMerchantSelect_(candidates, data, workspaceId) {
  var aliases = financeApiV1DashboardReadRows_(
    "MERCHANT_ALIASES",
    ["MERCHANT_KEY", "ENTRY_TYPE", "CANONICAL_NAME"],
    workspaceId
  );
  var inputMerchant = financeApiV1MobileNormalize_(data.merchant);
  var merchantNames = [data.merchant, data.description];
  aliases.forEach(function(alias) {
    var aliasType = financeApiV1MobileNormalize_(alias.ENTRY_TYPE);
    var paymentType = financeApiV1MobileNormalize_(data.paymentFunction);
    var key = financeApiV1MobileNormalize_(alias.MERCHANT_KEY);
    var canonical = financeApiV1MobileNormalize_(alias.CANONICAL_NAME);
    if (
      (!aliasType || !paymentType ||
        aliasType.indexOf(paymentType) >= 0 ||
        paymentType.indexOf(aliasType) >= 0) &&
      inputMerchant &&
      (key === inputMerchant || canonical === inputMerchant)
    ) {
      merchantNames.push(alias.MERCHANT_KEY, alias.CANONICAL_NAME);
    }
  });
  merchantNames = financeApiV1MobileUnique_(merchantNames.filter(Boolean));
  var matches = candidates.filter(function(item) {
    return merchantNames.some(function(name) {
      return financeApiV1MobileTextMatches_(name, item.description);
    });
  });
  if (matches.length === 1) return { commitment: matches[0] };
  return {
    pending: true,
    reason: matches.length
      ? "compromisso_ambiguo"
      : "compromisso_nao_confirmado",
    message: matches.length
      ? "Há mais de um compromisso compatível; requer revisão manual."
      : "Não foi possível confirmar o compromisso pelo estabelecimento ou descrição."
  };
}

function financeApiV1MobileApplyTransaction_(eventState, data, commitment) {
  if (commitment && commitment.source === "DEBT") {
    return {
      pending: true,
      reason: "conciliacao_de_divida_nao_suportada",
      status: "PENDENTE_REVISAO",
      message: "O modelo atual não registra pagamentos individuais de dívidas."
    };
  }
  if (commitment && commitment.source === "INVOICE") {
    return {
      pending: true,
      reason: "conciliacao_de_fatura_nao_suportada",
      status: "PENDENTE_REVISAO",
      message: "A fatura não tem total conciliável no modelo atual."
    };
  }
  if (commitment && data.installments > 1) {
    return {
      pending: true,
      reason: "parcelamento_compromisso_existente",
      status: "PENDENTE_REVISAO",
      message: "O compromisso existente não pode ser convertido automaticamente em parcelamento."
    };
  }
  if (data.installments > 1) {
    var plan = financeApiV1MobileCreateInstallmentPlan_(eventState, data);
    return {
      status: "PARCELAMENTO",
      installmentPlanId: plan.ID,
      message: "Parcelamento registrado como não verificado."
    };
  }
  var transaction = commitment && commitment.source === "TRANSACTION"
    ? financeApiV1MobileUpdateTransaction_(eventState, data, commitment)
    : financeApiV1MobileCreateTransaction_(eventState, data, Boolean(commitment));
  if (commitment && commitment.source === "RECURRENCE") {
    financeApiV1MobileCompleteRecurrenceEvent_(
      eventState.workspaceId, commitment, transaction, data
    );
  }
  return {
    status: commitment ? "CONCILIADO" : "INSERIDO_AVULSO",
    transactionId: transaction.ID,
    message: commitment
      ? "Movimentação conciliada e marcada como não verificada."
      : "Lançamento inserido como não verificado."
  };
}

function financeApiV1MobileCreateTransaction_(eventState, data, reconciled) {
  var table = financeApiV1ReadTable_("TRANSACTIONS", [
    "ID", "WORKSPACE_ID", "ACCOUNT_ID", "CARD_ID", "CATEGORY_ID",
    "TRANSACTION_TYPE", "DIRECTION", "AMOUNT", "CURRENCY", "OCCURRED_AT",
    "COMPETENCE_DATE", "DESCRIPTION", "PAYMENT_FUNCTION",
    "INSTALLMENT_NUMBER", "INSTALLMENT_COUNT", "CASH_FLOW_TIMING",
    "REVIEW_STATUS", "AFFECTS_CASH_BALANCE", "VISIBILITY_STATUS",
    "RECONCILIATION_STATUS", "SOURCE_TYPE", "SOURCE_KEY", "NOTES",
    "METADATA_JSON", "CREATED_AT", "UPDATED_AT", "RECORD_VERSION", "DELETED_AT"
  ]);
  var now = new Date();
  var creditInvoice = data.direction === "EXPENSE" &&
    data.paymentFunction === "Crédito";
  var record = {
    ID: eventState.id,
    WORKSPACE_ID: eventState.workspaceId,
    ACCOUNT_ID: String(data.account.ID),
    CARD_ID: data.card ? String(data.card.ID) : "",
    CATEGORY_ID: data.category ? String(data.category.ID) : "",
    TRANSACTION_TYPE: data.event === "ESTORNO" ? "REFUND" : "ONE_OFF",
    DIRECTION: data.direction,
    AMOUNT: Math.round(Math.abs(data.amount) * 100) / 100,
    CURRENCY: data.currency || String(data.account.CURRENCY || "BRL"),
    OCCURRED_AT: data.date,
    COMPETENCE_DATE: data.date,
    DESCRIPTION: data.description,
    PAYMENT_FUNCTION: data.paymentFunction,
    INSTALLMENT_NUMBER: 1,
    INSTALLMENT_COUNT: 1,
    CASH_FLOW_TIMING: creditInvoice ? "INVOICE" : "DIRECT",
    REVIEW_STATUS: FINANCE_API_V1_MOBILE.REVIEW_STATUS,
    AFFECTS_CASH_BALANCE: !creditInvoice,
    VISIBILITY_STATUS: "VISIBLE",
    RECONCILIATION_STATUS: reconciled ? "RECONCILED" : "UNRECONCILED",
    SOURCE_TYPE: "MOBILE_" + eventState.entryType,
    SOURCE_KEY: eventState.id,
    NOTES: financeApiV1MobileNote_(data),
    METADATA_JSON: JSON.stringify({
      externalEventId: eventState.id,
      externalId: eventState.externalId,
      source: eventState.entryType,
      merchant: data.merchant || ""
    }),
    CREATED_AT: now,
    UPDATED_AT: now,
    RECORD_VERSION: 1,
    DELETED_AT: ""
  };
  financeApiV1AppendRecord_(table, record);
  financeApiV1MobileAuditCreate_(
    eventState, "TRANSACTIONS", record.ID, record, "entity.create"
  );
  return record;
}

function financeApiV1MobileUpdateTransaction_(eventState, data, commitment) {
  var table = financeApiV1ReadTable_("TRANSACTIONS", [
    "ID", "WORKSPACE_ID", "ACCOUNT_ID", "CARD_ID", "CATEGORY_ID",
    "TRANSACTION_TYPE", "DIRECTION", "AMOUNT", "CURRENCY", "OCCURRED_AT",
    "COMPETENCE_DATE", "DESCRIPTION", "PAYMENT_FUNCTION",
    "INSTALLMENT_NUMBER", "INSTALLMENT_COUNT", "CASH_FLOW_TIMING",
    "REVIEW_STATUS", "AFFECTS_CASH_BALANCE", "VISIBILITY_STATUS",
    "RECONCILIATION_STATUS", "SOURCE_TYPE", "SOURCE_KEY", "NOTES",
    "METADATA_JSON", "CREATED_AT", "UPDATED_AT", "RECORD_VERSION", "DELETED_AT"
  ]);
  var rowIndex = table.rows.findIndex(function(row) {
    return String(row[table.headers.indexOf("ID")]) === String(commitment.id) &&
      String(row[table.headers.indexOf("WORKSPACE_ID")]) === eventState.workspaceId &&
      !row[table.headers.indexOf("DELETED_AT")];
  });
  if (rowIndex < 0) {
    financeApiV1Throw_(
      "MOBILE_COMMITMENT_NOT_FOUND",
      "O lançamento previsto não foi encontrado para conciliação."
    );
  }
  var before = financeApiV1RowObject_(table.headers, table.rows[rowIndex]);
  var record = Object.assign({}, before);
  var creditInvoice = data.direction === "EXPENSE" &&
    data.paymentFunction === "Crédito";
  record.ACCOUNT_ID = String(data.account.ID);
  record.CARD_ID = data.card ? String(data.card.ID) : record.CARD_ID;
  record.CATEGORY_ID = data.category
    ? String(data.category.ID)
    : record.CATEGORY_ID;
  record.DIRECTION = data.direction;
  record.AMOUNT = Math.round(Math.abs(data.amount) * 100) / 100;
  record.CURRENCY = data.currency || String(data.account.CURRENCY || "BRL");
  record.OCCURRED_AT = data.date;
  record.COMPETENCE_DATE = data.date;
  record.DESCRIPTION = data.description;
  record.PAYMENT_FUNCTION = data.paymentFunction;
  record.CASH_FLOW_TIMING = creditInvoice ? "INVOICE" : "DIRECT";
  record.REVIEW_STATUS = FINANCE_API_V1_MOBILE.REVIEW_STATUS;
  record.AFFECTS_CASH_BALANCE = !creditInvoice;
  record.VISIBILITY_STATUS = "VISIBLE";
  record.RECONCILIATION_STATUS = "RECONCILED";
  record.NOTES = financeApiV1MobileAppendNote_(
    record.NOTES, financeApiV1MobileNote_(data)
  );
  record.UPDATED_AT = new Date();
  record.RECORD_VERSION = Number(record.RECORD_VERSION || 0) + 1;
  table.sheet.getRange(rowIndex + 2, 1, 1, table.headers.length)
    .setValues([table.headers.map(function(header) {
      return record[header] === undefined ? "" : record[header];
    })]);
  financeApiV1MobileAuditChange_(
    eventState,
    "TRANSACTIONS",
    record.ID,
    "entity.update",
    Number(record.RECORD_VERSION),
    before,
    record
  );
  return record;
}

function financeApiV1MobileCreateInstallmentPlan_(eventState, data) {
  var table = financeApiV1ReadTable_("INSTALLMENT_PLANS", [
    "ID", "WORKSPACE_ID", "ACCOUNT_ID", "CARD_ID", "CATEGORY_ID",
    "DESCRIPTION", "TOTAL_AMOUNT", "INSTALLMENT_COUNT", "PURCHASE_DATE",
    "FIRST_INVOICE_MONTH", "INSTALLMENT_AMOUNT", "LAST_INSTALLMENT_AMOUNT",
    "REVIEW_STATUS", "STATUS", "SOURCE_TYPE", "SOURCE_KEY", "CREATED_AT",
    "UPDATED_AT", "RECORD_VERSION", "DELETED_AT"
  ]);
  var total = Math.round(Math.abs(data.amount) * 100) / 100;
  var installmentAmount = Math.floor(total * 100 / data.installments) / 100;
  var lastAmount = Math.round(
    (total - installmentAmount * (data.installments - 1)) * 100
  ) / 100;
  var firstInvoiceMonth = financeApiV1MobileFirstInvoiceMonth_(
    data.date, data.card
  );
  var now = new Date();
  var plan = {
    ID: Utilities.getUuid(),
    WORKSPACE_ID: eventState.workspaceId,
    ACCOUNT_ID: String(data.account.ID),
    CARD_ID: data.card ? String(data.card.ID) : "",
    CATEGORY_ID: data.category ? String(data.category.ID) : "",
    DESCRIPTION: data.description,
    TOTAL_AMOUNT: total,
    INSTALLMENT_COUNT: data.installments,
    PURCHASE_DATE: data.date,
    FIRST_INVOICE_MONTH: firstInvoiceMonth,
    INSTALLMENT_AMOUNT: installmentAmount,
    LAST_INSTALLMENT_AMOUNT: lastAmount,
    REVIEW_STATUS: FINANCE_API_V1_MOBILE.REVIEW_STATUS,
    STATUS: "ACTIVE",
    SOURCE_TYPE: "MOBILE_" + eventState.entryType,
    SOURCE_KEY: eventState.id,
    CREATED_AT: now,
    UPDATED_AT: now,
    RECORD_VERSION: 1,
    DELETED_AT: ""
  };
  financeApiV1AppendRecord_(table, plan);
  financeApiV1MobileAuditCreate_(
    eventState, "INSTALLMENT_PLANS", plan.ID, plan, "entity.create"
  );
  return plan;
}

function financeApiV1MobileCompleteRecurrenceEvent_(
  workspaceId, commitment, transaction, data
) {
  var parts = String(commitment.id || "").split(":");
  if (parts.length !== 3 || parts[0] !== "recurrence") {
    financeApiV1Throw_(
      "INVALID_RECURRENCE_COMMITMENT",
      "O identificador da recorrência não é válido."
    );
  }
  var recurrenceId = parts[1];
  var occurrenceDate = financeApiV1MobileDate_(parts[2]);
  if (!occurrenceDate) {
    financeApiV1Throw_(
      "INVALID_RECURRENCE_DATE",
      "A data da ocorrência recorrente não é válida."
    );
  }
  var table = financeApiV1ReadTable_("RECURRENCE_EVENTS", [
    "ID", "WORKSPACE_ID", "RECURRENCE_ID", "OCCURRENCE_DATE",
    "COMPETENCE_DATE", "EVENT_STATUS", "TRANSACTION_ID", "AMOUNT",
    "NOTES", "CREATED_AT", "UPDATED_AT", "RECORD_VERSION", "DELETED_AT"
  ]);
  var rowIndex = table.rows.findIndex(function(row) {
    return String(row[table.headers.indexOf("WORKSPACE_ID")]) === workspaceId &&
      String(row[table.headers.indexOf("RECURRENCE_ID")]) === recurrenceId &&
      financeApiV1DashboardDateKey_(
        row[table.headers.indexOf("OCCURRENCE_DATE")]
      ) === parts[2] &&
      !row[table.headers.indexOf("DELETED_AT")];
  });
  var now = new Date();
  var record;
  if (rowIndex >= 0) {
    var before = financeApiV1RowObject_(table.headers, table.rows[rowIndex]);
    record = Object.assign({}, before);
    record.COMPETENCE_DATE = data.date;
    record.EVENT_STATUS = "PAID";
    record.TRANSACTION_ID = transaction.ID;
    record.AMOUNT = Math.abs(data.amount);
    record.NOTES = financeApiV1MobileAppendNote_(
      record.NOTES, "Pago via evento mobile " + transaction.ID
    );
    record.UPDATED_AT = now;
    record.RECORD_VERSION = Number(record.RECORD_VERSION || 0) + 1;
    table.sheet.getRange(rowIndex + 2, 1, 1, table.headers.length)
      .setValues([table.headers.map(function(header) {
        return record[header] === undefined ? "" : record[header];
      })]);
    financeApiV1MobileAuditChange_(
      { id: transaction.SOURCE_KEY, workspaceId: workspaceId },
      "RECURRENCE_EVENTS",
      record.ID,
      "entity.update",
      Number(record.RECORD_VERSION),
      before,
      record
    );
    return record;
  }
  record = {
    ID: Utilities.getUuid(),
    WORKSPACE_ID: workspaceId,
    RECURRENCE_ID: recurrenceId,
    OCCURRENCE_DATE: occurrenceDate,
    COMPETENCE_DATE: data.date,
    EVENT_STATUS: "PAID",
    TRANSACTION_ID: transaction.ID,
    AMOUNT: Math.abs(data.amount),
    NOTES: "Pago conciliado via evento mobile " + transaction.ID,
    CREATED_AT: now,
    UPDATED_AT: now,
    RECORD_VERSION: 1,
    DELETED_AT: ""
  };
  financeApiV1AppendRecord_(table, record);
  financeApiV1MobileAuditCreate_(
    { id: transaction.SOURCE_KEY, workspaceId: workspaceId },
    "RECURRENCE_EVENTS",
    record.ID,
    record,
    "entity.create"
  );
  return record;
}

function financeApiV1MobileCancelTransaction_(eventState, data) {
  if (data.missing.some(function(field) {
    return ["data", "valor", "descricao", "tipo_movimento"].indexOf(field) >= 0;
  })) {
    return {
      pending: true,
      reason: "dados_cancelamento_insuficientes",
      message: "Dados insuficientes para localizar a compra original."
    };
  }
  var table = financeApiV1ReadTable_("TRANSACTIONS", [
    "ID", "WORKSPACE_ID", "ACCOUNT_ID", "CARD_ID", "DIRECTION", "AMOUNT",
    "CURRENCY", "OCCURRED_AT", "DESCRIPTION", "PAYMENT_FUNCTION",
    "REVIEW_STATUS", "VISIBILITY_STATUS", "NOTES", "RECORD_VERSION", "UPDATED_AT",
    "DELETED_AT"
  ]);
  var candidates = table.rows.map(function(row, index) {
    return {
      row: row,
      rowIndex: index,
      record: financeApiV1RowObject_(table.headers, row)
    };
  }).filter(function(item) {
    var record = item.record;
    return String(record.WORKSPACE_ID) === eventState.workspaceId &&
      !record.DELETED_AT &&
    String(record.DIRECTION) === (data.direction || "EXPENSE") &&
      financeApiV1MobileDateDifference_(
        financeApiV1MobileDate_(record.OCCURRED_AT), data.date
      ) <= FINANCE_API_V1_MOBILE.RECONCILIATION_DATE_WINDOW_DAYS &&
      Math.abs(Math.abs(Number(record.AMOUNT)) - Math.abs(data.amount)) <=
        FINANCE_API_V1_MOBILE.RECONCILIATION_VALUE_TOLERANCE &&
      (!data.account || String(record.ACCOUNT_ID) === String(data.account.ID)) &&
      (!data.card || String(record.CARD_ID) === String(data.card.ID)) &&
      financeApiV1MobileTextMatches_(data.merchant || data.description, record.DESCRIPTION);
  });
  if (candidates.length !== 1) {
    return {
      pending: true,
      reason: candidates.length ? "cancelamento_ambiguo" : "compra_original_nao_encontrada",
      message: candidates.length
        ? "Mais de uma compra pode corresponder ao cancelamento."
        : "Não foi encontrada uma compra original única para cancelar."
    };
  }
  var target = candidates[0];
  var before = target.record;
  var after = Object.assign({}, before);
  var now = new Date();
  after.REVIEW_STATUS = "CANCELLED";
  after.VISIBILITY_STATUS = "ARCHIVED";
  after.NOTES = financeApiV1MobileAppendNote_(
    after.NOTES, financeApiV1MobileNote_(data)
  );
  after.DELETED_AT = now;
  after.UPDATED_AT = now;
  after.RECORD_VERSION = Number(after.RECORD_VERSION || 0) + 1;
  table.sheet.getRange(target.rowIndex + 2, 1, 1, table.headers.length)
    .setValues([table.headers.map(function(header) {
      return after[header] === undefined ? "" : after[header];
    })]);
  financeApiV1MobileAuditChange_(
    eventState,
    "TRANSACTIONS",
    after.ID,
    "entity.delete",
    Number(after.RECORD_VERSION),
    before,
    after
  );
  return { transactionId: after.ID };
}

function financeApiV1MobileFindDuplicateTransaction_(workspaceId, data) {
  var table = financeApiV1ReadTable_("TRANSACTIONS", [
    "ID", "WORKSPACE_ID", "ACCOUNT_ID", "DIRECTION", "AMOUNT", "CURRENCY",
    "OCCURRED_AT", "DESCRIPTION", "PAYMENT_FUNCTION", "DELETED_AT"
  ]);
  return table.rows.map(function(row) {
    return financeApiV1RowObject_(table.headers, row);
  }).filter(function(record) {
    var merchantOrDescriptionMatches = [
      data.merchant, data.description
    ].filter(Boolean).some(function(value) {
      return financeApiV1MobileTextMatches_(value, record.DESCRIPTION);
    });
    return String(record.WORKSPACE_ID) === workspaceId &&
      !record.DELETED_AT &&
      String(record.ACCOUNT_ID) === String(data.account.ID) &&
      financeApiV1DashboardDirection_(record.DIRECTION) === data.direction &&
      String(record.CURRENCY || "").toUpperCase() ===
        String(data.currency || data.account.CURRENCY || "").toUpperCase() &&
      Math.abs(Math.abs(Number(record.AMOUNT)) - Math.abs(Number(data.amount))) <=
        FINANCE_API_V1_MOBILE.RECONCILIATION_VALUE_TOLERANCE &&
      Math.abs(financeApiV1MobileDayDifference_(
        financeApiV1MobileDate_(record.OCCURRED_AT), data.date
      )) <= FINANCE_API_V1_MOBILE.RECONCILIATION_DATE_WINDOW_DAYS &&
      merchantOrDescriptionMatches &&
      (
        !record.PAYMENT_FUNCTION ||
        financeApiV1MobileFunction_(record.PAYMENT_FUNCTION) ===
          data.paymentFunction
      );
  })[0] || null;
}

function financeApiV1MobileStartEvent_(workspaceId, request, rawBody, initialError) {
  var table = financeApiV1ReadTable_(
    FINANCE_API_V1_MOBILE.EVENT_SHEET,
    FINANCE_API_V1_MOBILE.EVENT_HEADERS
  );
  var source = financeApiV1MobileEntryType_(
    request && (request.origem || request.source || request.tipo)
  );
  var externalId = request
    ? financeApiV1MobileExternalId_(request, request)
    : "";
  var externalIndex = table.headers.indexOf("EXTERNAL_ID");
  var workspaceIndex = table.headers.indexOf("WORKSPACE_ID");
  var sourceIndex = table.headers.indexOf("ENTRY_TYPE");
  var statusIndex = table.headers.indexOf("PROCESSING_STATUS");
  var deletedIndex = table.headers.indexOf("DELETED_AT");
  var duplicateOf = externalId ? table.rows.map(function(row) {
    return financeApiV1RowObject_(table.headers, row);
  }).filter(function(record) {
    var status = String(record[table.headers[statusIndex]]).toUpperCase();
    return String(record[table.headers[workspaceIndex]]) === workspaceId &&
      String(record[table.headers[externalIndex]]) === externalId &&
      String(record[table.headers[sourceIndex]]).toUpperCase() === source &&
      !record[table.headers[deletedIndex]] &&
      ([
        "SUCESSO", "INSERIDO_AVULSO", "PARCELAMENTO", "CONCILIADO",
        "CONCILIADO_ATUALIZADO", "CANCELADA",
        "IGNORADO_NAO_TRANSACIONAL", "IGNORADO_TRANSFERENCIA_PROPRIA",
        "IGNORADO_PIX_SEM_CONTRAPARTE"
      ].indexOf(status) >= 0 ||
      financeApiV1MobileHasLinkedEntity_(
        workspaceId, String(record.ID || "")
      ));
  })[0] || null : null;
  var now = new Date();
  var record = {
    ID: Utilities.getUuid(),
    WORKSPACE_ID: workspaceId,
    EXTERNAL_ID: externalId,
    ENTRY_TYPE: source,
    RECEIVED_AT: now,
    TRANSACTION_DATE: "",
    DESCRIPTION: "",
    AMOUNT: "",
    CURRENCY: "",
    ACCOUNT_ID: "",
    CARD_LAST_FOUR: "",
    MERCHANT: "",
    CATEGORY_LABEL: "",
    LATITUDE: "",
    LONGITUDE: "",
    NOTES: initialError || (duplicateOf ? "Duplicado de " + duplicateOf.ID : ""),
    PROCESSING_STATUS: duplicateOf ? "DUPLICADO" : "PROCESSING",
    PAYLOAD_JSON: financeApiV1MobilePayloadJson_(request, rawBody),
    SOURCE_TYPE: "MOBILE",
    CREATED_AT: now,
    UPDATED_AT: now,
    RECORD_VERSION: 1,
    DELETED_AT: ""
  };
  financeApiV1AppendRecord_(table, record);
  return {
    id: record.ID,
    workspaceId: workspaceId,
    externalId: externalId,
    entryType: source,
    duplicateOf: duplicateOf
      ? { id: String(duplicateOf.ID), status: String(duplicateOf.PROCESSING_STATUS || "") }
      : null,
    sheet: table.sheet,
    headers: table.headers,
    rowNumber: table.sheet.getLastRow(),
    request: request,
    rawBody: rawBody
  };
}

function financeApiV1MobileUpdateEventFields_(eventState, data) {
  var patch = {};
  if (data.date) patch.TRANSACTION_DATE = data.date;
  if (data.description) patch.DESCRIPTION = data.description;
  if (data.amount !== null) patch.AMOUNT = Math.abs(data.amount);
  if (data.currency) patch.CURRENCY = data.currency;
  if (data.account) patch.ACCOUNT_ID = String(data.account.ID);
  if (data.cardLastFour) patch.CARD_LAST_FOUR = data.cardLastFour;
  if (data.merchant) patch.MERCHANT = data.merchant;
  if (data.categoryLabel) patch.CATEGORY_LABEL = data.categoryLabel;
  if (data.latitude !== null) patch.LATITUDE = data.latitude;
  if (data.longitude !== null) patch.LONGITUDE = data.longitude;
  financeApiV1MobilePatchEvent_(eventState, patch);
}

function financeApiV1MobileFinishEvent_(
  eventState, status, message, data, outcome
) {
  var payload = {
    request: financeApiV1MobileRedact_(eventState.request),
    rawBody: eventState.request ? "" : String(eventState.rawBody || ""),
    extracted: data ? financeApiV1MobilePublicData_(data) : null,
    outcome: outcome || null
  };
  var patch = {
    PROCESSING_STATUS: status,
    NOTES: String(message || "").substring(0, 1000),
    PAYLOAD_JSON: financeApiV1MobileBoundedJson_(payload),
    UPDATED_AT: new Date()
  };
  if (data) {
    if (data.date) patch.TRANSACTION_DATE = data.date;
    if (data.description) patch.DESCRIPTION = data.description;
    if (data.amount !== null) patch.AMOUNT = Math.abs(data.amount);
    if (data.currency) patch.CURRENCY = data.currency;
    if (data.account) patch.ACCOUNT_ID = String(data.account.ID);
    if (data.cardLastFour) patch.CARD_LAST_FOUR = data.cardLastFour;
    if (data.merchant) patch.MERCHANT = data.merchant;
    if (data.categoryLabel) patch.CATEGORY_LABEL = data.categoryLabel;
    if (data.latitude !== null) patch.LATITUDE = data.latitude;
    if (data.longitude !== null) patch.LONGITUDE = data.longitude;
  }
  financeApiV1MobilePatchEvent_(eventState, patch);
}

function financeApiV1MobilePatchEvent_(eventState, patch) {
  var row = eventState.sheet.getRange(
    eventState.rowNumber, 1, 1, eventState.headers.length
  ).getValues()[0];
  Object.keys(patch).forEach(function(field) {
    var index = eventState.headers.indexOf(field);
    if (index >= 0) row[index] = patch[field];
  });
  var versionIndex = eventState.headers.indexOf("RECORD_VERSION");
  if (versionIndex >= 0) {
    row[versionIndex] = Number(row[versionIndex] || 1) + 1;
  }
  eventState.sheet.getRange(
    eventState.rowNumber, 1, 1, eventState.headers.length
  ).setValues([row]);
}

function financeApiV1MobileAuditCreate_(
  eventState, entityType, entityId, record, action
) {
  financeApiV1Audit_(
    "MOBILE_AUTOMATION",
    eventState.workspaceId,
    action,
    entityType,
    entityId,
    { mobileEventId: eventState.id, source: eventState.entryType }
  );
  financeApiV1Changelog_(
    eventState.workspaceId,
    entityType,
    entityId,
    action,
    Number(record.RECORD_VERSION || 1),
    eventState.id,
    "MOBILE_AUTOMATION",
    { after: record }
  );
}

function financeApiV1MobileHasLinkedEntity_(workspaceId, eventId) {
  if (!eventId) return false;
  var entities = [
    { sheet: "TRANSACTIONS", fields: ["SOURCE_KEY", "NOTES"] },
    { sheet: "INSTALLMENT_PLANS", fields: ["SOURCE_KEY"] }
  ];
  for (var index = 0; index < entities.length; index++) {
    var table = financeApiV1ReadTable_(
      entities[index].sheet,
      ["ID", "WORKSPACE_ID", "DELETED_AT"].concat(entities[index].fields)
    );
    var sourceIndex = table.headers.indexOf("SOURCE_KEY");
    var notesIndex = table.headers.indexOf("NOTES");
    var workspaceIndex = table.headers.indexOf("WORKSPACE_ID");
    if (table.rows.some(function(row) {
      return String(row[workspaceIndex]) === workspaceId &&
        (
          sourceIndex >= 0 && String(row[sourceIndex]) === eventId ||
          notesIndex >= 0 && String(row[notesIndex] || "").indexOf(eventId) >= 0
        );
    })) {
      return true;
    }
  }
  var changes = financeApiV1ReadTable_("CHANGELOG", [
    "ID", "WORKSPACE_ID", "OPERATION_ID"
  ]);
  return changes.rows.some(function(row) {
    return String(row[changes.headers.indexOf("WORKSPACE_ID")]) === workspaceId &&
      String(row[changes.headers.indexOf("OPERATION_ID")]) === eventId;
  });
}

function financeApiV1MobileFindPriorCompletedEvent_(
  workspaceId, entryType, externalId, currentEventId
) {
  var table = financeApiV1ReadTable_(
    FINANCE_API_V1_MOBILE.EVENT_SHEET,
    FINANCE_API_V1_MOBILE.EVENT_HEADERS
  );
  return table.rows.map(function(row) {
    return financeApiV1RowObject_(table.headers, row);
  }).filter(function(record) {
    if (
      String(record.ID) === currentEventId ||
      String(record.WORKSPACE_ID) !== workspaceId ||
      String(record.EXTERNAL_ID) !== externalId ||
      String(record.ENTRY_TYPE).toUpperCase() !== entryType ||
      record.DELETED_AT
    ) {
      return false;
    }
    var status = String(record.PROCESSING_STATUS || "").toUpperCase();
    return [
      "SUCESSO", "INSERIDO_AVULSO", "PARCELAMENTO", "CONCILIADO",
      "CONCILIADO_ATUALIZADO", "CANCELADA",
      "IGNORADO_NAO_TRANSACIONAL", "IGNORADO_TRANSFERENCIA_PROPRIA",
      "IGNORADO_PIX_SEM_CONTRAPARTE"
    ].indexOf(status) >= 0 ||
      financeApiV1MobileHasLinkedEntity_(workspaceId, String(record.ID || ""));
  })[0] || null;
}

function financeApiV1MobileAuditChange_(
  eventState, entityType, entityId, action, version, before, after
) {
  financeApiV1Audit_(
    "MOBILE_AUTOMATION",
    eventState.workspaceId,
    action,
    entityType,
    entityId,
    { mobileEventId: eventState.id, source: eventState.entryType }
  );
  var changes = { before: {}, after: {} };
  Object.keys(after).forEach(function(field) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      changes.before[field] = before[field];
      changes.after[field] = after[field];
    }
  });
  financeApiV1Changelog_(
    eventState.workspaceId,
    entityType,
    entityId,
    action,
    version,
    eventState.id,
    "MOBILE_AUTOMATION",
    changes
  );
}

function financeApiV1MobileWorkspaceId_() {
  var workspaceId = PropertiesService.getScriptProperties().getProperty(
    FINANCE_API_V1.WORKSPACE_ID_PROPERTY
  );
  financeApiV1FindWorkspace_(workspaceId);
  return String(workspaceId);
}

function financeApiV1MobileEntryType_(value) {
  var source = String(value || "SMS").trim().toUpperCase();
  if (["PUSH", "SMS", "EMAIL", "FILE", "WALLET", "DEFAULT"].indexOf(source) >= 0) {
    return source;
  }
  if (source.indexOf("PUSH") >= 0) return "PUSH";
  if (source.indexOf("SMS") >= 0) return "SMS";
  if (source.indexOf("EMAIL") >= 0) return "EMAIL";
  if (source.indexOf("FILE") >= 0) return "FILE";
  if (source.indexOf("WALLET") >= 0) return "WALLET";
  return "DEFAULT";
}

function financeApiV1MobileIsActive_(record) {
  return !record.DELETED_AT &&
    (!record.STATUS || financeApiV1MobileIsEnabled_(record.STATUS));
}

function financeApiV1MobileIsEnabled_(value) {
  if (value === true || value === 1) return true;
  return ["TRUE", "1", "ACTIVE", "OPEN", "ENABLED", "SIM", "ATIVO"].indexOf(
    String(value || "").trim().toUpperCase()
  ) >= 0;
}

function financeApiV1MobileIsTrue_(value) {
  return value === true || value === 1 ||
    ["TRUE", "1", "YES", "SIM"].indexOf(
      String(value || "").trim().toUpperCase()
    ) >= 0;
}

function financeApiV1MobileIsGenericPix_(data) {
  var fields = [data.merchant, data.description].map(function(value) {
    return financeApiV1MobileNormalize_(value);
  }).filter(Boolean);
  var genericDescription =
    /^(?:pix(?:\s+(?:enviado|recebido))?|transferencia(?:\s+via)?\s+pix)(?:\s+(?:no\s+)?(?:app|aplicativo)\s+[a-z0-9 ]+)?$/;
  return !fields.length || fields.every(function(value) {
    return genericDescription.test(value);
  });
}

function financeApiV1MobileFunction_(value) {
  var text = financeApiV1MobileNormalize_(value);
  if (text === "credito") return "Crédito";
  if (text === "debito") return "Débito";
  if (text === "pix") return "Pix";
  if (text === "beneficio") return "Benefício";
  return "";
}

function financeApiV1MobileDirection_(value) {
  var text = financeApiV1MobileNormalize_(value).toUpperCase();
  if (["ENTRADA", "INCOME", "RECEITA", "RECEBIDO"].indexOf(text) >= 0) {
    return "INCOME";
  }
  if (["SAIDA", "EXPENSE", "DESPESA", "PAGAMENTO"].indexOf(text) >= 0) {
    return "EXPENSE";
  }
  return "";
}

function financeApiV1MobileNormalize_(value) {
  return String(value || "").trim().toLocaleLowerCase("pt-BR")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function financeApiV1MobileText_(value) {
  return value === null || value === undefined
    ? ""
    : String(value).trim().substring(0, 1000);
}

function financeApiV1MobileNumber_(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return isFinite(value) ? value : null;
  var text = String(value).trim().replace(/[^\d,.\-]/g, "");
  if (!text) return null;
  if (text.indexOf(",") >= 0) {
    text = text.replace(/\./g, "").replace(",", ".");
  }
  var number = Number(text);
  return isFinite(number) ? number : null;
}

function financeApiV1MobileDate_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return isFinite(value.getTime()) ? value : null;
  }
  var text = String(value || "").trim();
  var iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(text);
  var br = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  var year;
  var month;
  var day;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (br) {
    day = Number(br[1]);
    month = Number(br[2]);
    year = Number(br[3]);
    if (br[3].length === 2) year += 2000;
  } else {
    return null;
  }
  var date = new Date(year, month - 1, day, 12, 0, 0);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null;
}

function financeApiV1MobileLastFour_(value) {
  var digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

function financeApiV1MobileExternalId_(request, payload) {
  var keys = [
    "external_id", "externalId", "notification_id", "notificationId",
    "id_transacao", "transaction_id", "email_id", "idempotencyKey"
  ];
  for (var index = 0; index < keys.length; index++) {
    var value = request && request[keys[index]] ||
      payload && payload[keys[index]];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim().substring(0, 200);
    }
  }
  return "";
}

function financeApiV1MobileUnique_(values) {
  return values.filter(function(value, index) {
    return value && values.indexOf(value) === index;
  });
}

function financeApiV1MobileDayDifference_(first, second) {
  if (!first || !second) return Infinity;
  var firstTime = Date.UTC(
    first.getFullYear(), first.getMonth(), first.getDate()
  );
  var secondTime = Date.UTC(
    second.getFullYear(), second.getMonth(), second.getDate()
  );
  return Math.abs(Math.round((firstTime - secondTime) / 86400000));
}

function financeApiV1MobileTextMatches_(first, second) {
  var a = financeApiV1MobileNormalize_(first);
  var b = financeApiV1MobileNormalize_(second);
  if (!a || !b) return false;
  return a === b ||
    (a.length >= 5 && b.indexOf(a) >= 0) ||
    (b.length >= 5 && a.indexOf(b) >= 0);
}

function financeApiV1MobileNote_(data) {
  var note = "Registro mobile (" + data.entryType + ")";
  if (data.mobileEventId) note += " evento " + data.mobileEventId;
  note += ".";
  return data.merchant ? note + " Estabelecimento: " + data.merchant : note;
}

function financeApiV1MobileAppendNote_(current, addition) {
  return [String(current || "").trim(), String(addition || "").trim()]
    .filter(Boolean).join(" | ").substring(0, 5000);
}

function financeApiV1MobileFirstInvoiceMonth_(date, card) {
  var year = date.getFullYear();
  var month = date.getMonth();
  var closingDay = card ? Number(card.CLOSING_DAY || 0) : 0;
  if (closingDay && date.getDate() > closingDay) month += 1;
  var first = new Date(year, month, 1);
  return Utilities.formatDate(first, Session.getScriptTimeZone(), "yyyy-MM");
}

function financeApiV1MobilePayloadJson_(request, rawBody) {
  var payload = request
    ? { request: financeApiV1MobileRedact_(request) }
    : { rawBody: String(rawBody || "").substring(0, 30000) };
  return financeApiV1MobileBoundedJson_(payload);
}

function financeApiV1MobileRedact_(value) {
  if (Array.isArray(value)) {
    return value.map(financeApiV1MobileRedact_);
  }
  if (!value || typeof value !== "object") return value;
  var result = {};
  Object.keys(value).forEach(function(key) {
    if (/^(token|access_token|password|secret|authorization|api_key)$/i.test(key)) {
      return;
    }
    result[key] = financeApiV1MobileRedact_(value[key]);
  });
  return result;
}

function financeApiV1MobileBoundedJson_(value) {
  var json = JSON.stringify(value);
  if (json.length <= FINANCE_API_V1_MOBILE.MAX_PAYLOAD_LENGTH) return json;
  return JSON.stringify({
    truncated: true,
    payloadPreview: json.substring(0, FINANCE_API_V1_MOBILE.MAX_PAYLOAD_LENGTH - 100)
  });
}

function financeApiV1MobilePublicData_(data) {
  return {
    event: data.event,
    date: data.date ? financeApiV1DashboardDateKey_(data.date) : "",
    amount: data.amount,
    currency: data.currency,
    description: data.description,
    merchant: data.merchant,
    accountId: data.account ? data.account.ID : "",
    categoryId: data.category ? data.category.ID : "",
    cardLastFour: data.cardLastFour,
    paymentFunction: data.paymentFunction,
    direction: data.direction,
    installments: data.installments,
    missing: data.missing
  };
}

