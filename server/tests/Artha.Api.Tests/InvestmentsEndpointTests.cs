using System.Net;
using System.Net.Http.Json;
using Artha.Api.Dtos;
using Artha.Api.Tests.Infrastructure;
using FluentAssertions;

namespace Artha.Api.Tests;

public sealed class InvestmentsEndpointTests : IClassFixture<ArthaTestFactory>
{
    private readonly ArthaTestFactory _factory;

    public InvestmentsEndpointTests(ArthaTestFactory factory)
    {
        _factory = factory;
    }

    private HttpClient AuthedClient(string userId)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.UserHeader, userId);
        return client;
    }

    private static InvestmentUpsertRequest Rd(string name = "SBI RD") => new(
        Name: name,
        Type: "recurring_deposit",
        Currency: "INR",
        InvestedAmount: 60000m,
        CurrentValue: 62000m,
        InterestRate: 6.5m,
        InstallmentAmount: 5000m,
        StartDate: new DateOnly(2026, 1, 1),
        MaturityDate: new DateOnly(2026, 12, 31),
        Institution: "State Bank of India",
        PolicyOrAccountNumber: null,
        Note: null,
        Color: "#22c55e",
        Icon: null);

    [Fact]
    public async Task Get_Bootstrap_ReturnsEmptyList()
    {
        var client = AuthedClient("user-inv-empty");

        var investments = await client.GetFromJsonAsync<List<InvestmentDto>>("/api/investments");

        investments.Should().NotBeNull();
        investments!.Should().BeEmpty();
    }

    [Fact]
    public async Task Post_AddsRecurringDeposit()
    {
        var client = AuthedClient("user-inv-add");

        var response = await client.PostAsJsonAsync("/api/investments", Rd());
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var list = await client.GetFromJsonAsync<List<InvestmentDto>>("/api/investments");
        list.Should().ContainSingle(i =>
            i.Name == "SBI RD" &&
            i.Type == "recurring_deposit" &&
            i.Currency == "INR" &&
            i.InstallmentAmount == 5000m &&
            i.InterestRate == 6.5m);
    }

    [Fact]
    public async Task Post_RecurringDepositWithoutInstallment_Returns400()
    {
        var client = AuthedClient("user-inv-no-installment");

        var response = await client.PostAsJsonAsync("/api/investments",
            Rd() with { InstallmentAmount = null });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Post_InvalidType_Returns400()
    {
        var client = AuthedClient("user-inv-bad-type");

        var response = await client.PostAsJsonAsync("/api/investments",
            Rd() with { Type = "crypto" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Post_DuplicateName_Returns400()
    {
        var client = AuthedClient("user-inv-dup");

        await client.PostAsJsonAsync("/api/investments", Rd("My RD"));
        var second = await client.PostAsJsonAsync("/api/investments", Rd("MY RD"));

        second.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Post_MutualFund_DoesNotRequireRate()
    {
        var client = AuthedClient("user-inv-mf");

        var response = await client.PostAsJsonAsync("/api/investments", new InvestmentUpsertRequest(
            Name: "Nifty Index Fund",
            Type: "mutual_fund",
            Currency: "INR",
            InvestedAmount: 100000m,
            CurrentValue: 118500m,
            InterestRate: null,
            InstallmentAmount: null,
            StartDate: null,
            MaturityDate: null,
            Institution: "UTI",
            PolicyOrAccountNumber: null,
            Note: "Long-term SIP",
            Color: null,
            Icon: null));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Put_UpdatesInvestment()
    {
        var client = AuthedClient("user-inv-update");

        var created = await client.PostAsJsonAsync("/api/investments", Rd("HDFC RD"));
        var dto = await created.Content.ReadFromJsonAsync<InvestmentDto>();

        var put = await client.PutAsJsonAsync($"/api/investments/{dto!.Id}",
            Rd("HDFC RD") with { CurrentValue = 65000m });
        put.StatusCode.Should().Be(HttpStatusCode.OK);

        var list = await client.GetFromJsonAsync<List<InvestmentDto>>("/api/investments");
        list.Should().ContainSingle(i => i.Name == "HDFC RD" && i.CurrentValue == 65000m);
    }

    [Fact]
    public async Task Delete_SoftDeletes()
    {
        var client = AuthedClient("user-inv-archive");

        var created = await client.PostAsJsonAsync("/api/investments", Rd("Closed RD"));
        var dto = await created.Content.ReadFromJsonAsync<InvestmentDto>();

        var del = await client.DeleteAsync($"/api/investments/{dto!.Id}");
        del.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var visible = await client.GetFromJsonAsync<List<InvestmentDto>>("/api/investments");
        visible.Should().NotContain(i => i.Id == dto.Id);

        var withArchived = await client.GetFromJsonAsync<List<InvestmentDto>>("/api/investments?includeArchived=true");
        withArchived.Should().Contain(i => i.Id == dto.Id && i.Archived);
    }

    [Fact]
    public async Task Post_PersistsDateOnlyFields()
    {
        var client = AuthedClient("user-inv-dates");

        var created = await client.PostAsJsonAsync("/api/investments", Rd("Dated RD"));
        var dto = await created.Content.ReadFromJsonAsync<InvestmentDto>();

        dto!.StartDate.Should().Be(new DateOnly(2026, 1, 1));
        dto.MaturityDate.Should().Be(new DateOnly(2026, 12, 31));
    }
}
