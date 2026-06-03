using System.Net;
using System.Net.Http.Json;
using Artha.Api.Dtos;
using Artha.Api.Tests.Infrastructure;
using FluentAssertions;

namespace Artha.Api.Tests;

public sealed class AccountsEndpointTests : IClassFixture<ArthaTestFactory>
{
    private readonly ArthaTestFactory _factory;

    public AccountsEndpointTests(ArthaTestFactory factory)
    {
        _factory = factory;
    }

    private HttpClient AuthedClient(string userId)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.UserHeader, userId);
        return client;
    }

    [Fact]
    public async Task Get_Bootstrap_ReturnsDefaultCashAccount()
    {
        var client = AuthedClient("user-acc-defaults");

        var accounts = await client.GetFromJsonAsync<List<AccountDto>>("/api/accounts");

        accounts.Should().NotBeNull();
        accounts!.Should().HaveCount(1);
        accounts[0].Id.Should().Be("acc-cash");
        accounts[0].Name.Should().Be("Cash");
        accounts[0].Type.Should().Be("cash");
    }

    [Fact]
    public async Task Post_AddsCheckingAccount()
    {
        var client = AuthedClient("user-acc-add");

        var response = await client.PostAsJsonAsync("/api/accounts",
            new AccountUpsertRequest("HDFC Checking", "checking", "INR", 5000m, "#3b82f6", "card"));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var list = await client.GetFromJsonAsync<List<AccountDto>>("/api/accounts");
        list.Should().HaveCount(2);
        list.Should().ContainSingle(a => a.Name == "HDFC Checking" &&
            a.Type == "checking" &&
            a.Currency == "INR" &&
            a.OpeningBalance == 5000m);
    }

    [Fact]
    public async Task Post_DuplicateName_Returns400()
    {
        var client = AuthedClient("user-acc-dup");

        await client.PostAsJsonAsync("/api/accounts",
            new AccountUpsertRequest("Wallet", "cash", "USD", 0m, null, null));
        var second = await client.PostAsJsonAsync("/api/accounts",
            new AccountUpsertRequest("WALLET", "cash", "USD", 0m, null, null));

        second.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Post_InvalidType_Returns400()
    {
        var client = AuthedClient("user-acc-bad-type");

        var response = await client.PostAsJsonAsync("/api/accounts",
            new AccountUpsertRequest("Crypto Wallet", "bitcoin", "USD", 0m, null, null));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Put_UpdatesAccount()
    {
        var client = AuthedClient("user-acc-update");

        var created = await client.PostAsJsonAsync("/api/accounts",
            new AccountUpsertRequest("Visa", "credit_card", "USD", -1200m, "#a855f7", "card"));
        var dto = await created.Content.ReadFromJsonAsync<AccountDto>();

        var put = await client.PutAsJsonAsync($"/api/accounts/{dto!.Id}",
            new AccountUpsertRequest("Visa Platinum", "credit_card", "USD", -800m, "#a855f7", "card"));
        put.StatusCode.Should().Be(HttpStatusCode.OK);

        var list = await client.GetFromJsonAsync<List<AccountDto>>("/api/accounts");
        list.Should().ContainSingle(a => a.Name == "Visa Platinum" && a.OpeningBalance == -800m);
    }

    [Fact]
    public async Task Post_And_Put_RoundTripBank()
    {
        var client = AuthedClient("user-acc-bank");

        // Create with a bank — it should come back on the response...
        var created = await client.PostAsJsonAsync("/api/accounts",
            new AccountUpsertRequest("HDFC Savings", "savings", "INR", 1000m, null, null, "hdfc"));
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var dto = await created.Content.ReadFromJsonAsync<AccountDto>();
        dto!.Bank.Should().Be("hdfc");

        // ...and survive a re-fetch (proves it persists, not just echoes).
        var list = await client.GetFromJsonAsync<List<AccountDto>>("/api/accounts");
        list!.Should().ContainSingle(a => a.Id == dto.Id && a.Bank == "hdfc");

        // PUT can change the bank.
        var put = await client.PutAsJsonAsync($"/api/accounts/{dto.Id}",
            new AccountUpsertRequest("HDFC Savings", "savings", "INR", 1000m, null, null, "icici"));
        put.StatusCode.Should().Be(HttpStatusCode.OK);
        var updated = await put.Content.ReadFromJsonAsync<AccountDto>();
        updated!.Bank.Should().Be("icici");
    }

    [Fact]
    public async Task Delete_DefaultAccount_Returns400()
    {
        var client = AuthedClient("user-acc-no-default-del");

        var response = await client.DeleteAsync("/api/accounts/acc-cash");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Delete_UnreferencedAccount_SoftDeletes()
    {
        var client = AuthedClient("user-acc-archive");

        var created = await client.PostAsJsonAsync("/api/accounts",
            new AccountUpsertRequest("Closed Savings", "savings", "USD", 0m, null, null));
        var dto = await created.Content.ReadFromJsonAsync<AccountDto>();

        var del = await client.DeleteAsync($"/api/accounts/{dto!.Id}");
        del.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var visible = await client.GetFromJsonAsync<List<AccountDto>>("/api/accounts");
        visible.Should().NotContain(a => a.Id == dto.Id);

        var withArchived = await client.GetFromJsonAsync<List<AccountDto>>("/api/accounts?includeArchived=true");
        withArchived.Should().Contain(a => a.Id == dto.Id && a.Archived);
    }

    [Fact]
    public async Task Delete_ReferencedAccount_Returns409()
    {
        var client = AuthedClient("user-acc-in-use");

        var created = await client.PostAsJsonAsync("/api/accounts",
            new AccountUpsertRequest("Salary", "checking", "USD", 0m, null, null));
        var dto = await created.Content.ReadFromJsonAsync<AccountDto>();

        await client.PostAsJsonAsync("/api/expenses", new ExpenseCreateRequest(
            new DateOnly(2026, 5, 15), 50m, "cat-food", dto!.Id, null));

        var response = await client.DeleteAsync($"/api/accounts/{dto.Id}");
        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task PostExpense_RequiresValidAccount()
    {
        var client = AuthedClient("user-acc-bad-on-expense");

        var response = await client.PostAsJsonAsync("/api/expenses", new ExpenseCreateRequest(
            new DateOnly(2026, 5, 15), 10m, "cat-food", "acc-nonexistent", null));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task PostExpense_PersistsAccountId()
    {
        var client = AuthedClient("user-acc-on-expense");

        var created = await client.PostAsJsonAsync("/api/accounts",
            new AccountUpsertRequest("Wallet", "cash", "USD", 100m, null, null));
        var account = await created.Content.ReadFromJsonAsync<AccountDto>();

        await client.PostAsJsonAsync("/api/expenses", new ExpenseCreateRequest(
            new DateOnly(2026, 5, 15), 10m, "cat-food", account!.Id, null));

        var list = await client.GetFromJsonAsync<ExpenseListResponse>("/api/expenses?from=2026-05&to=2026-05");
        list!.Items.Should().HaveCount(1);
        list.Items[0].AccountId.Should().Be(account.Id);
    }

    [Fact]
    public async Task PostExpense_BlankAccountId_FallsBackToDefault()
    {
        // Lenient behaviour for legacy clients still on the pre-M5 contract:
        // empty AccountId -> default Cash account, not a 400.
        var client = AuthedClient("user-acc-blank");

        var response = await client.PostAsJsonAsync("/api/expenses", new ExpenseCreateRequest(
            new DateOnly(2026, 5, 15), 10m, "cat-food", "", null));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var list = await client.GetFromJsonAsync<ExpenseListResponse>("/api/expenses?from=2026-05&to=2026-05");
        list!.Items[0].AccountId.Should().Be("acc-cash");
    }
}
